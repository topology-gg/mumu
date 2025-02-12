import MechState, {MechStatus, MechType} from '../src/types/MechState';
import AtomState, {AtomStatus, AtomType} from '../src/types/AtomState';
import Grid from '../src/types/Grid'
import BoardConfig from '../src/types/BoardConfig';
import Frame from '../src/types/Frame';
import { OperatorType, OPERATOR_TYPES } from '../src/types/Operator';
import { STATIC_COSTS, DYNAMIC_COSTS } from '../src/types/Cost';
import { ECDH } from 'crypto';

export function isIdenticalGrid (
    grid1 : Grid,
    grid2 : Grid
): boolean {
    return JSON.stringify(grid1) == JSON.stringify(grid2)
}

//
// a pure function that runs simulation for fixed cycles
//
export default function simulator(
    n_cycles : number,
    mechs : MechState[],
    atoms : AtomState[],
    instructionSets : string[][],
    boardConfig: BoardConfig, // including atom faucet, operator, atom sink - these don't change in frames
): Frame[] {

    // logging
    console.log("> simulator receives mechs:", mechs)
    console.log("> simulator receives instructionSets:", instructionSets)
    console.log("> simulator receives boardConfig:", boardConfig)

    // guardrail
    if (!boardConfig) {return []}

    // Note: when implementing this function in smart contract,
    // must implement config verification, particularly - verify the validity of operator placement

    //
    // Calculate base cost based on number of operators and number of mechs used
    //
    let base_cost = 0
    mechs.forEach((mech) => {
        if (mech.typ == MechType.SINGLETON) base_cost += STATIC_COSTS.SINGLETON
    })
    boardConfig.operators.forEach((operator) => {
        if (operator.typ.symbol == '&') base_cost += STATIC_COSTS.STIR
        else if (operator.typ.symbol == '%') base_cost += STATIC_COSTS.SHAKE
        else if (operator.typ.symbol == '^') base_cost += STATIC_COSTS.STEAM
        else if (operator.typ.symbol == '#') base_cost += STATIC_COSTS.SMASH
    })

    //
    // Prepare the first frame
    //
    var grid_populated_bools : { [key: string] : boolean } = {}
    for (var i=0; i<boardConfig.dimension; i++){
        for (var j=0; j<boardConfig.dimension; j++){
            grid_populated_bools[JSON.stringify({x:i,y:j})] = false
        }
    }
    for (const atom of atoms) {
        grid_populated_bools[JSON.stringify(atom.index)] = true
    }
    const frame_init : Frame= {
        mechs: mechs,
        atoms: atoms,
        grid_populated_bools: grid_populated_bools,
        delivered_accumulated: [],
        cost_accumulated: base_cost,
        notes: '',
    }

    //
    // Forward system by n_cycles;
    // Record frames emitted;
    // each frame carries all objects with their states i.e. frame == state screenshot
    //
    var frame_s: Frame[] = [frame_init]
    for (var cycle_i=0; cycle_i<n_cycles; cycle_i++) {
        //
        // Prepare instruction for each mech;
        // if mech is blocked, it stays at its current instruction, otherwise advances to next instruction
        //
        var instruction_per_mech = []
        frame_s[frame_s.length-1].mechs.forEach((mech:MechState, mech_i:number) => {
            // get mech's sequence of instructions
            const instructionSet = instructionSets[mech_i]

            // pick instruction at pc_next
            const instruction = instructionSet [mech.pc_next % instructionSet.length]

            // record instruction to be executed for this mech in this frame
            instruction_per_mech.push (instruction)
        })
        // console.log(`cycle ${i}, instruction_per_mech ${JSON.stringify(instruction_per_mech)}`)

        // Run simulate_one_cycle()
        const last_frame = frame_s[frame_s.length-1]
        const new_frame: Frame = _simulate_one_cycle (
            instruction_per_mech,
            last_frame,
            boardConfig
        )
        // console.log('frame.atoms', i, ":", JSON.stringify(frame.atoms))

        // Record frame emitted
        frame_s.push(new_frame)
    }

    return frame_s
}

//
// a pure function that runs simulation for one cycle, according to instruction input
//
function _simulate_one_cycle (
    instruction_per_mech: string[],
    frame_curr: Frame, // {mechs, atoms, grid_populated_bools}
    boardConfig: BoardConfig
): Frame {
    //
    // Unpack frame
    //
    const mechs_curr = frame_curr.mechs // array of {'id':'mech..', 'index':{x:..,y:..}, 'status':'..', 'typ':'..'}
    const atoms_curr = frame_curr.atoms // array of {'id':'atom..', 'index':{x:..,y:..}, 'status':'..', 'typ':'..'}
    const grid_populated_bools = frame_curr.grid_populated_bools // mapping 'x..y..' => true/false

    //
    // Prepare mutable variable for this cycle pass
    //
    var mechs_new: MechState[] = []
    var atoms_new: AtomState[] = JSON.parse(JSON.stringify(atoms_curr)) // object cloning
    var grid_populated_bools_new: { [key: string] : boolean } = JSON.parse(JSON.stringify(grid_populated_bools)) // object cloning
    var cost_accumulated_new = frame_curr.cost_accumulated // a primitive type variable (number) can be cloned by '='
    var notes = ''

    //
    // Iterate through atom faucets
    //
    for (const atom_faucet of boardConfig.atom_faucets) {
        if (grid_populated_bools_new[JSON.stringify(atom_faucet.index)] == false){
            const atom_new: AtomState= {
                id: `atom${atoms_new.length}`, typ: atom_faucet.typ, status: AtomStatus.FREE, index: atom_faucet.index, possessed_by: null
            }
            atoms_new.push (atom_new)
            grid_populated_bools_new[JSON.stringify(atom_faucet.index)] = true
        }
    }

    //
    // Iterate through mechs
    //
    // for (const mech of mechs_curr) {
    mechs_curr.map((mech: MechState, mech_i: number) => {

        // backward compatibility: convert instruction to lowercase letter; convert '_' to '.'
        let instruction: string = instruction_per_mech[mech_i].toLowerCase()
        if (instruction == '_') instruction = '.'

        var mech_new = {id:mech.id, typ:mech.typ, index:mech.index, status:mech.status, pc_next:mech.pc_next}

        // console.log (`mech${mech_i} running ${instruction}`)

        // add note
        notes += `intended ${instruction}/`

        if (instruction == 'd'){ // x-positive

            // non-blocking
            mech_new.pc_next += 1

            if (mech.index.x < boardConfig.dimension-1) {
                // move mech
                mech_new.index = {x:mech.index.x+1, y:mech.index.y}

                // move atom if possessed by this mech
                let has_moved_atom = false
                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.status == AtomStatus.POSSESSED && atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.index.x += 1
                        theArray[i] = atom_new
                        has_moved_atom = true
                    }
                });

                // update cost
                if (has_moved_atom) cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_CARRY
                else cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_EMPTY

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 'a'){ // x-negative

            // non-blocking
            mech_new.pc_next += 1

            if (mech.index.x > 0) {
                // move mech
                mech_new.index = {x:mech.index.x-1, y:mech.index.y}

                // move atom if possessed by this mech
                let has_moved_atom = false
                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.status == AtomStatus.POSSESSED && atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.index.x -= 1
                        theArray[i] = atom_new
                        has_moved_atom = true
                    }
                });

                // update cost
                if (has_moved_atom) cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_CARRY
                else cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_EMPTY

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 's'){ // y-positive

            // non-blocking
            mech_new.pc_next += 1

            if (mech.index.y < boardConfig.dimension-1) {
                mech_new.index = {x:mech.index.x, y:mech.index.y+1}

                // move atom if possessed by this mech
                let has_moved_atom = false
                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.status == AtomStatus.POSSESSED && atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.index.y += 1
                        theArray[i] = atom_new
                        has_moved_atom = true
                    }
                });

                // update cost
                if (has_moved_atom) cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_CARRY
                else cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_EMPTY

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 'w'){ // y-negative

            // non-blocking
            mech_new.pc_next += 1

            if (mech.index.y > 0) {
                mech_new.index = {x:mech.index.x, y:mech.index.y-1}

                // move atom if possessed by this mech
                let has_moved_atom = false
                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.status == AtomStatus.POSSESSED && atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.index.y -= 1
                        theArray[i] = atom_new
                        has_moved_atom = true
                    }
                });

                // update cost
                if (has_moved_atom) cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_CARRY
                else cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_MOVE_EMPTY

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 'z'){ // GET

            // non-blocking
            mech_new.pc_next += 1

            if (
                    (mech.status == MechStatus.OPEN) &&
                    (grid_populated_bools_new[JSON.stringify(mech.index)] == true) // atom available for grab here
            ) {
                mech_new.status = MechStatus.CLOSE
                grid_populated_bools_new[JSON.stringify(mech.index)] = false

                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if ( isIdenticalGrid(atom.index, mech.index) && atom.status==AtomStatus.FREE ){
                        var atom_new = theArray[i]
                        atom_new.status = AtomStatus.POSSESSED
                        atom_new.possessed_by = mech.id
                        theArray[i] = atom_new
                    }
                });

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_GET

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 'x'){ // PUT

            // non-blocking
            mech_new.pc_next += 1

            if (
                    (mech.status == MechStatus.CLOSE) &&
                    (grid_populated_bools_new[JSON.stringify(mech.index)] == false) // can drop atom here
            ) {
                mech_new.status = MechStatus.OPEN
                grid_populated_bools_new[JSON.stringify(mech.index)] = true

                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.status = AtomStatus.FREE
                        atom_new.possessed_by = null
                        theArray[i] = atom_new
                    }
                });

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_PUT

                // add note
                notes += 'success/'
            }
            else {
                // add note
                notes += 'fail/'
            }
        }
        else if (instruction == 'g'){ // block-until-pickup
            // Note: the mech will wait at this instruction until its location has a free atom to be picked up;
            // it then picks up the free atom in the same frame, and proceed to its next instruction in the next frame;
            // if the mech is closed when encountering this instruction (i.e. not able to pick up), this instruction is treated as no-op.

            if (mech.status == MechStatus.CLOSE) { // treated as no-op; does not incur cost
                mech_new.pc_next += 1

                // add note
                notes += 'no-op/'
            }
            else if (grid_populated_bools_new[JSON.stringify(mech.index)] == false) { // no atom for pick-up
                mech_new.pc_next = mech_new.pc_next // blocked

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_BLOCKED

                // add note
                notes += 'blocked/'
            }
            else {
                mech_new.pc_next += 1

                // pick up the atom
                // TODO: refactor the following code which is copied from the if statement for GET
                mech_new.status = MechStatus.CLOSE
                grid_populated_bools_new[JSON.stringify(mech.index)] = false

                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if ( isIdenticalGrid(atom.index, mech.index) && atom.status==AtomStatus.FREE ){
                        var atom_new = theArray[i]
                        atom_new.status = AtomStatus.POSSESSED
                        atom_new.possessed_by = mech.id
                        theArray[i] = atom_new
                    }
                });

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_GET

                // add note
                notes += 'success/'
            }

        }
        else if (instruction == 'h'){ // block-until-drop
            // the mech will wait at this instruction until its location is empty for drop-off;
            // it then drops off the atom in possession in the same frame, and proceed to its next instruction in the next frame;
            // if the mech is open when encountering this instruction
            // (i.e. not possessing an atom for drop-off), this instruction is treated as no-op.


            if (mech.status == MechStatus.OPEN) { // treated as no-op; does not incur cost
                mech_new.pc_next += 1

                // add note
                notes += 'no-op/'
            }
            else if (grid_populated_bools_new[JSON.stringify(mech.index)] == true) { // can't drop because grid populated
                mech_new.pc_next = mech_new.pc_next // blocked

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_BLOCKED

                // add note
                notes += 'blocked/'
            }
            else {
                mech_new.pc_next += 1

                // drop the atom
                // TODO: refactor the following code which is copied from the if statement for PUT

                mech_new.status = MechStatus.OPEN
                grid_populated_bools_new[JSON.stringify(mech.index)] = true

                atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
                    if (atom.possessed_by == mech.id){
                        var atom_new = theArray[i]
                        atom_new.status = AtomStatus.FREE
                        atom_new.possessed_by = null
                        theArray[i] = atom_new
                    }
                });

                // update cost
                cost_accumulated_new += DYNAMIC_COSTS.SINGLETON_PUT

                // add note
                notes += 'success/'
            }
        }
        else if (instruction == '.'){
            // non-blocking
            mech_new.pc_next += 1
        }

        // record the new mech
        mechs_new.push (mech_new)

        // add note
        notes += JSON.stringify(mech) + ' => ' + JSON.stringify(mech_new) + ';'
    })

    //
    // Iterate through operators
    //
    for (const operator of boardConfig.operators){

        // check if input grids are occupied with atoms, and output grids are empty (no partial reaction allowed)
        let operator_grid_condition_met = true
        for (const grid of operator.input){
            operator_grid_condition_met = operator_grid_condition_met && grid_populated_bools_new[JSON.stringify(grid)]
        }
        for (const grid of operator.output){
            operator_grid_condition_met = operator_grid_condition_met && !grid_populated_bools_new[JSON.stringify(grid)]
        }

        if (operator_grid_condition_met){

            // Find the sequence of atom types for input grids
            // TODO improve implementation
            let atom_type_for_each_input: AtomType[] = Array.from({length:operator.input.length}).fill(AtomType.VANILLA) as Array<AtomType>
            let atom_index_for_each_input: number[] = Array.from({length:operator.input.length}).fill(0) as Array<number>
            atoms_new.forEach((atom: AtomState, atom_i: number) => {

                operator.input.forEach((input_grid, input_i) => {
                    if (isIdenticalGrid(atom.index, input_grid) && atom.status==AtomStatus.FREE) {
                        atom_type_for_each_input[input_i] = atom.typ
                        atom_index_for_each_input[input_i] = atom_i
                    }
                })

            })

            // check if atoms occupying the input grids meet formula condition
            let match = true
            operator.typ.input_atom_types.forEach((supposed_input_type, i) => {
                match = match && (supposed_input_type == atom_type_for_each_input[i])
            })
            if (match){
                notes += operator.typ.description + ';'

                // updates for input
                for (const grid of operator.input){
                    grid_populated_bools_new[JSON.stringify(grid)] = false
                }
                for (const atom_i of atom_index_for_each_input){
                    atoms_new[atom_i].status = AtomStatus.CONSUMED
                }

                // updates for output
                operator.output.forEach((output_grid, output_i) => {
                    grid_populated_bools_new[JSON.stringify(output_grid)] = true
                    const atom_new: AtomState = {
                        id: `atom${atoms_new.length}`,
                        typ: operator.typ.output_atom_types[output_i],
                        status: AtomStatus.FREE,
                        index: output_grid,
                        possessed_by: null
                    }
                    atoms_new.push(atom_new)
                })

            }

        }
    }

    //
    // Iterate through atom sinks
    //
    var delivered_accumulated_new: AtomType[] = JSON.parse(JSON.stringify(frame_curr.delivered_accumulated))
    for (const atom_sink of boardConfig.atom_sinks) {
        // iterate through atoms, see if a 'free' one is lying at this sink
        atoms_new.forEach(function (atom: AtomState, i: number, theArray: AtomState[]) {
            if ( isIdenticalGrid(atom.index, atom_sink.index) && atom.status==AtomStatus.FREE ){
                var atom_new = theArray[i]
                atom_new.status = AtomStatus.DELIVERED
                atom_new.possessed_by = null
                theArray[i] = atom_new

                delivered_accumulated_new.push (atom_new.typ)

                // mark the grid not-populated
                grid_populated_bools_new[JSON.stringify(atom_sink.index)] = false
            }
        });
    }

    //
    // Pack a new frame and return
    //
    const frame_new: Frame = {
        mechs: mechs_new,
        atoms: atoms_new,
        grid_populated_bools: grid_populated_bools_new,
        delivered_accumulated: delivered_accumulated_new,
        cost_accumulated: cost_accumulated_new,
        notes: notes
    }
    return frame_new
}

// Note:
// atom source replenish
// atom operator churn
// machine churn
// housekeeping
