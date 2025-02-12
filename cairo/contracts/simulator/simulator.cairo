%lang starknet

from starkware.cairo.common.alloc import alloc
from starkware.cairo.common.memcpy import memcpy
from starkware.cairo.common.math import unsigned_div_rem
from starkware.cairo.common.math_cmp import is_le
from starkware.starknet.common.syscalls import get_caller_address
from starkware.cairo.common.default_dict import default_dict_new, default_dict_finalize
from starkware.cairo.common.dict_access import DictAccess

from contracts.simulator.constants import (
    ns_summary,
    ns_mechs,
    ns_atoms,
    ns_atom_faucets,
    ns_atom_sinks,
    ns_instructions,
    ns_grid,
    Summary,
)

from contracts.simulator.mechs import (
    InputMechState,
    init_mechs,
    get_mechs_cost,
    iterate_mechs,
    verify_volumes,
)
from contracts.simulator.atoms import (
    AtomState,
    AtomFaucetState,
    AtomSinkState,
    populate_faucets,
    iterate_sinks,
    fill_piping,
)
from contracts.simulator.operators import (
    verify_valid_operators,
    get_operators_cost,
    iterate_operators,
)
from contracts.simulator.instructions import get_frame_instruction_set
from contracts.simulator.grid import Grid

from contracts.simulator.events import new_simulation, end_summary

// @notice Simulates the run for current inputs for 100 cycles
// @param music_title A shortstring name for this submission in DAW mode; 0 if not in DAW mode
// @param mechs The array of mechs
// @param instructions_sets The length of each mech's instructions
// @param instructions The array of all mechs' instructions concatenated together
// @param operators_inputs The array of operators inputs
// @param operators_output The array of operators outputs
// @param operators_type The array of operators type
// @param mech_volumes The array of volume (midi velocity) value for each mech for DAW mode
// @param faucets The array of faucets on the board
// @param sinks The array of sinks on the board
@external
func simulator{syscall_ptr: felt*, range_check_ptr}(
    music_title: felt,
    mechs_len: felt,
    mechs: InputMechState*,
    instructions_sets_len: felt,
    instructions_sets: felt*,
    instructions_len: felt,
    instructions: felt*,
    operators_inputs_len: felt,
    operators_inputs: Grid*,
    operators_outputs_len: felt,
    operators_outputs: Grid*,
    operators_type_len: felt,
    operators_type: felt*,
    mech_volumes_len: felt,
    mech_volumes: felt*,
    faucets_len: felt,
    faucets: AtomFaucetState*,
    sinks_len: felt,
    sinks: AtomSinkState*,
) {
    alloc_locals;
    let board_dimension = 10;
    let is_valid_mech_len = is_le(mechs_len, 25);
    with_attr error_message("mech length limited to 25") {
        assert is_valid_mech_len = 1;
    }
    with_attr error_message("mismatched volume and mech length") {
        assert mech_volumes_len = mechs_len;
    }
    with_attr error_message("invalid volume") {
        verify_volumes(mech_volumes_len, mech_volumes);
    }

    //
    // Create the piping array
    //
    let (piping: Grid*) = alloc();
    let (piping) = fill_piping(
        piping, faucets_len, cast(faucets, felt*), ns_atom_faucets.ATOM_FAUCET_SIZE, 0
    );
    let (piping) = fill_piping(
        piping, sinks_len, cast(sinks, felt*), ns_atom_sinks.ATOM_SINK_SIZE, faucets_len
    );

    //
    // verify the operators are valid following 3 rules
    //
    verify_valid_operators(
        sinks_len + faucets_len,
        piping,
        operators_type_len,
        operators_type,
        operators_inputs_len,
        operators_inputs,
        operators_outputs_len,
        operators_outputs,
        board_dimension,
    );

    //
    // Calculate base cost based on operators and mechs used
    //
    let base_cost_operators = get_operators_cost(operators_type_len, operators_type, 0);
    let base_cost_mechs = get_mechs_cost(mechs_len, mechs, 0);
    local base_cost = base_cost_operators + base_cost_mechs;

    //
    // Emit new simulation event
    //
    let (caller) = get_caller_address();
    new_simulation.emit(
        solver=caller,
        music_title=music_title,
        mechs_len=mechs_len,
        mechs=mechs,
        instructions_sets_len=instructions_sets_len,
        instructions_sets=instructions_sets,
        instructions_len=instructions_len,
        instructions=instructions,
        operators_inputs_len=operators_inputs_len,
        operators_inputs=operators_inputs,
        operators_outputs_len=operators_outputs_len,
        operators_outputs=operators_outputs,
        operators_type_len=operators_type_len,
        operators_type=operators_type,
        mech_volumes_len=mech_volumes_len,
        mech_volumes=mech_volumes,
        faucets_len=faucets_len,
        faucets=faucets,
        sinks_len=sinks_len,
        sinks=sinks,
        static_cost=base_cost,
    );

    //
    // Create atoms and mechs dict
    //
    let (atoms: DictAccess*) = default_dict_new(default_value=0);
    let (mech_dict: DictAccess*) = default_dict_new(default_value=0);
    let (mech_dict: DictAccess*) = init_mechs(mechs_len, mechs, mech_dict, board_dimension);

    //
    // Forward current world by 150, emiting summary at last frame
    //
    simulate_loop(
        150,
        0,
        board_dimension,
        instructions_sets_len,
        instructions_sets,
        instructions_len,
        instructions,
        mech_dict,
        atoms,
        faucets_len,
        faucets,
        sinks_len,
        sinks,
        operators_inputs_len,
        operators_inputs,
        operators_outputs_len,
        operators_outputs,
        operators_type_len,
        operators_type,
        Summary(0, base_cost, base_cost, 0, 0),
    );

    return ();
}

// @notice Simulates the run for current inputs for n_cycles cycles
// @param n_cycles The amount of cycles to simulate
// @param cycle The current cycle
// @param board_dimension The dimensions of the board
// @param instructions_sets The length of each mech's instructions
// @param instructions The array of all mechs' instructions concatenated together
// @param mechs The dictionary of mechs
// @param atoms The dictionary of atoms
// @param atom_faucets The array of faucets
// @param atom_sinks The array of sinks
// @param operators_inputs The array of operators inputs
// @param operators_output The array of operators outputs
// @param operators_type The array of operators type
// @param summary The summary for the simulation
func simulate_loop{syscall_ptr: felt*, range_check_ptr}(
    n_cycles: felt,
    cycle: felt,
    board_dimension: felt,
    instructions_sets_len: felt,
    instructions_sets: felt*,
    instructions_len: felt,
    instructions: felt*,
    mechs: DictAccess*,
    atoms: DictAccess*,
    atom_faucets_len: felt,
    atom_faucets: AtomFaucetState*,
    atom_sinks_len: felt,
    atom_sinks: AtomSinkState*,
    operators_inputs_len: felt,
    operators_inputs: Grid*,
    operators_outputs_len: felt,
    operators_outputs: Grid*,
    operators_type_len: felt,
    operators_type: felt*,
    summary: Summary,
) {
    alloc_locals;

    //
    // emit events at end of simulation
    //
    if (cycle == n_cycles) {
        default_dict_finalize(dict_accesses_start=atoms, dict_accesses_end=atoms, default_value=0);
        tempvar delivered = summary.delivered;
        if (delivered == 0) {
            end_summary.emit(delivered=0, latency=ns_summary.INF, dynamic_cost=ns_summary.INF);
        } else {
            let (average_dynamic_cost, _) = unsigned_div_rem(
                (summary.delivered_cost - summary.static_cost) * ns_summary.PRECISION, delivered
            );
            let (average_latency, _) = unsigned_div_rem(
                summary.frame * ns_summary.PRECISION, delivered
            );
            end_summary.emit(
                delivered=delivered, latency=average_latency, dynamic_cost=average_dynamic_cost
            );
        }
        return ();
    }

    //
    // get current frame instructions
    //
    let (local frame_instructions: felt*) = alloc();
    let (mechs) = get_frame_instruction_set(
        cycle,
        0,
        mechs,
        instructions_sets_len,
        instructions_sets,
        instructions,
        0,
        frame_instructions,
        0,
    );

    //
    // simulate one frame based on current state + instructions
    //
    let (mechs_new, atoms_new, summary_new) = simulate_one_frame(
        board_dimension,
        cycle,
        instructions_sets_len,
        frame_instructions,
        mechs,
        atoms,
        atom_faucets_len,
        atom_faucets,
        atom_sinks_len,
        atom_sinks,
        operators_inputs_len,
        operators_inputs,
        operators_outputs_len,
        operators_outputs,
        operators_type_len,
        operators_type,
        summary,
    );

    //
    // main simulation loop
    //
    simulate_loop(
        n_cycles,
        cycle + 1,
        board_dimension,
        instructions_sets_len,
        instructions_sets,
        instructions_len,
        instructions,
        mechs_new,
        atoms_new,
        atom_faucets_len,
        atom_faucets,
        atom_sinks_len,
        atom_sinks,
        operators_inputs_len,
        operators_inputs,
        operators_outputs_len,
        operators_outputs,
        operators_type_len,
        operators_type,
        summary_new,
    );
    return ();
}

// @notice Simulates the run for current inputs for one cycle
// @param board_dimension The dimensions of the board
// @param cycle The simulation cycle
// @param instructions The frame's instruction for each mech
// @param mechs The dictionary of mechs
// @param atoms The dictionary of atoms
// @param atom_faucets The array of faucets
// @param atom_sinks The array of sinks
// @param operators_inputs The array of operators inputs
// @param operators_output The array of operators outputs
// @param operators_type The array of operators type
// @param summary The summary of the simulation
// @return mechs_new The dictionary of updated mechs
// @return atoms_len_new The length of updated atoms
// @return atoms_new The dictionary of updated atoms
// @return summary_new The updated simulation summary
func simulate_one_frame{syscall_ptr: felt*, range_check_ptr}(
    board_dimension: felt,
    cycle: felt,
    instructions_len: felt,
    instructions: felt*,
    mechs: DictAccess*,
    atoms: DictAccess*,
    atom_faucets_len: felt,
    atom_faucets: AtomFaucetState*,
    atom_sinks_len: felt,
    atom_sinks: AtomSinkState*,
    operators_inputs_len: felt,
    operators_inputs: Grid*,
    operators_outputs_len: felt,
    operators_outputs: Grid*,
    operators_type_len: felt,
    operators_type: felt*,
    summary: Summary,
) -> (mechs_new: DictAccess*, atoms_new: DictAccess*, summary_new: Summary) {
    alloc_locals;

    let (atoms_new) = populate_faucets(atom_faucets_len, atom_faucets, atoms);

    //
    // Iterate through mechs
    //
    let (atoms_new, mechs_new, cost_increase) = iterate_mechs(
        board_dimension, mechs, 0, instructions_len, instructions, atoms_new, 0
    );

    //
    // Iterate through operators
    //
    let (atoms_new) = iterate_operators(
        atoms_new, operators_inputs, operators_outputs, operators_type_len, operators_type
    );

    //
    // Iterate through atom sinks
    //
    let (atoms_new, delivered_increase) = iterate_sinks(atom_sinks_len, atom_sinks, atoms_new, 0);

    //
    // Update summary
    //
    tempvar cost_new = summary.cost + cost_increase;
    if (delivered_increase == 0) {
        tempvar summary_new = Summary(summary.frame, cost_new, summary.static_cost, summary.delivered_cost, summary.delivered);
    } else {
        tempvar summary_new = Summary(cycle + 1, cost_new, summary.static_cost, cost_new, summary.delivered + delivered_increase);
    }

    return (mechs_new, atoms_new, summary_new);
}
