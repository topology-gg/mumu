import Head from "next/head";
import styles from "../styles/Home.module.css";
import React, { useState, useEffect, useMemo } from "react";
import simulator from "../src/components/simulator";
import MechState, { MechStatus, MechType } from "../src/types/MechState";
import AtomState, { AtomStatus, AtomType } from "../src/types/AtomState";
import AtomFaucetState from "../src/types/AtomFaucetState";
import BoardConfig from "../src/types/BoardConfig";
import Frame from "../src/types/Frame";

import UnitState, { BgStatus, BorderStatus, UnitText } from "../src/types/UnitState";
import Grid from "../src/types/Grid";
import Operator, { OPERATOR_TYPES, PlacingFormula } from "../src/types/Operator";
import Delivery from "../src/components/delivery";
import Summary from "../src/components/summary";
import { isGridOOB, areGridsNeighbors } from "../src/helpers/gridHelpers";

import { Modes, Constraints, BLANK_SOLUTION, DEMO_SOLUTIONS, ANIM_FRAME_LATENCY } from "../src/constants/constants";
import { useTranslation } from "react-i18next";
import "../config/i18n";
import { useAccount, useStarknetExecute } from "@starknet-react/core";
import packSolution, { programsToInstructionSets } from "../src/helpers/packSolution";
import { SIMULATOR_ADDR } from "../src/components/SimulatorContract";
import Solution from "../src/types/Solution";

import { Box, Button, Tooltip } from "@mui/material";
import MechProgramming from "../src/components/MechProgramming";
import Layout from "../src/components/Layout";
import LoadSave from "../src/components/LoadSave";
import theme from "../styles/theme";

import FormulaBlueprint from "../src/components/FormulaBlueprint";
import { placingFormulaToOperator } from "../src/helpers/typeMapping";
import Board from "../src/components/board";

export default function Home() {

    const { t } = useTranslation();

    // React state for current mode (which lessons of tutorial, or arena mode)
    // note: this impacts many components - board, mid screen control, programming components etc
    const [currMode, setCurrMode] = useState<Modes>(Modes.arena)

    // Constants unpack from current mode
    const DIM = Constraints[currMode].DIM
    const PROGRAM_SIZE_MAX = Constraints[currMode].PROGRAM_SIZE_MAX
    const MAX_NUM_MECHS = Constraints[currMode].MAX_NUM_MECHS
    const MAX_NUM_OPERATORS = Constraints[currMode].MAX_NUM_OPERATORS
    const N_CYCLES = Constraints[currMode].N_CYCLES
    const FAUCET_POS_S = Constraints[currMode].FAUCETS
    const SINK_POS_S = Constraints[currMode].SINKS
    const ATOMS = Constraints[currMode].ATOMS

    // Other constants
    const INIT_PROGRAM = ".";
    const INIT_DESCRIPTION = "New Spirit";
    var unitStatesInit = [];
    for (var x = 0; x < DIM; x++) {
        unitStatesInit.push(Array(DIM).fill({
            bg_status: BgStatus.EMPTY,
            border_status: BorderStatus.EMPTY,
            unit_text: UnitText.GRID,
            unit_id: null,
        }));
    }

    // React states for mechs, programs and descriptions
    const [programs, setPrograms] = useState<string[]>(BLANK_SOLUTION.programs);
    const [mechInitPositions, setMechInitPositions] = useState<Grid[]>(
        BLANK_SOLUTION.mechs.map((mech) => mech.index)
    );
    const [mechDescriptions, setMechDescriptions] = useState<string[]>(
        BLANK_SOLUTION.mechs.map((mech) => mech.description)
    );

    const numMechs = programs.length;

    // React states for operators
    const [operatorStates, setOperatorStates] = useState<Operator[]>(BLANK_SOLUTION.operators);
    const [placingFormula, setPlacingFormula] = useState<PlacingFormula>();
    const numOperators = operatorStates.length;

    // React useMemo
    const calls = useMemo(() => {
        let instructionSets = programsToInstructionSets(programs);
        const args = packSolution(instructionSets, mechInitPositions, mechDescriptions, operatorStates);
        // console.log ('> useMemo: args =', args)

        const tx = {
            contractAddress: SIMULATOR_ADDR,
            entrypoint: "simulator",
            calldata: args,
        };
        return [tx];
    }, [programs, mechInitPositions, mechDescriptions, operatorStates]);

    // React states for animation control
    const [animationState, setAnimationState] = useState("Stop");
    const [animationFrame, setAnimationFrame] = useState<number>(0);
    const [frames, setFrames] = useState<Frame[]>();
    const [loop, setLoop] = useState<NodeJS.Timer>();
    const [viewSolution, setViewSolution] = useState<Solution>(BLANK_SOLUTION);

    // React states for UI
    const [gridHovering, setGridHovering] = useState<[string, string]>(["-", "-"]);

    let operatorInputHighlightInit: boolean[] = Array(numOperators).fill(false);
    const [operatorInputHighlight, setOperatorInputHighlight] = useState<boolean[]>(operatorInputHighlightInit);

    const [mechIndexHighlighted, setMechIndexHighlighted] = useState<number>(-1);

    //
    // States derived from React states
    //
    const runnable = isRunnable();
    const mechInitStates: MechState[] = mechInitPositions.map((pos, mech_i) => {
        return {
            status: MechStatus.OPEN,
            index: pos,
            id: `mech${mech_i}`,
            typ: MechType.SINGLETON,
            description: mechDescriptions[mech_i],
            pc_next: 0,
        };
    });
    const atomInitStates: AtomState[] = ATOMS.map(function (atom, i) {
        return {
            status: AtomStatus.FREE,
            index: atom.index,
            id: `atom${i}`,
            typ: atom.typ,
            possessed_by: null,
        };
    });
    const frame = frames?.[animationFrame];
    const atomStates = frame?.atoms || atomInitStates;
    const mechStates = !frame ? mechInitStates : (animationState=='Stop' && animationFrame==0) ? mechInitStates : frame.mechs;
    const unitStates = setVisualForStates(atomStates, mechStates, unitStatesInit) as UnitState[][];

    let consumableAtomTypes: AtomType[][] = Array.from({ length: DIM }).map(
        _ => Array.from({ length: DIM }).map(_ => null)
    )
    for (const operatorState of operatorStates){
        operatorState.input.forEach((grid, i) => {consumableAtomTypes[grid.x][grid.y] = operatorState.typ.input_atom_types[i]})
    }
    let produceableAtomTypes: AtomType[][] = Array.from({ length: DIM }).map(
        _ => Array.from({ length: DIM }).map(_ => null)
    )
    for (const operatorState of operatorStates){
        operatorState.output.forEach((grid, i) => {produceableAtomTypes[grid.x][grid.y] = operatorState.typ.output_atom_types[i]})
    }

    const delivered = frame?.delivered_accumulated;
    const cost_accumulated = frame?.cost_accumulated || 0;
    const consumedAtomIds = frame?.consumed_atom_ids
    const producedAtomIds = frame?.produced_atom_ids

    let mech_carries: BgStatus[] = Array(mechInitPositions.length).fill(BgStatus.EMPTY);
    atomStates.forEach((atom: AtomState, atom_i: number) => {
        if (atom.status == AtomStatus.POSSESSED) {
            const mech_index: number = Number(atom.possessed_by.replace("mech", ""));

            let bgStatus: BgStatus;
            if (atom.typ == AtomType.VANILLA) {
                bgStatus = BgStatus.ATOM_VANILLA_FREE;
            } else if (atom.typ == AtomType.CHOCOLATE) {
                bgStatus = BgStatus.ATOM_CHOCOLATE_FREE;
            } else if (atom.typ == AtomType.HAZELNUT) {
                bgStatus = BgStatus.ATOM_HAZELNUT_FREE;
            } else if (atom.typ == AtomType.TRUFFLE) {
                bgStatus = BgStatus.ATOM_TRUFFLE_FREE;
            } else if (atom.typ == AtomType.SAFFRON) {
                bgStatus = BgStatus.ATOM_SAFFRON_FREE;
            } else if (atom.typ == AtomType.TURTLE) {
                bgStatus = BgStatus.ATOM_TURTLE_FREE;
            } else if (atom.typ == AtomType.SANDGLASS) {
                bgStatus = BgStatus.ATOM_SANDGLASS_FREE;
            } else if (atom.typ == AtomType.WILTED) {
                bgStatus = BgStatus.ATOM_WILTED_FREE;
            }

            mech_carries[mech_index] = bgStatus;
        }
    });

    // Starknet
    const { account, address, status } = useAccount();
    const { execute } = useStarknetExecute({ calls });

    ////////////////////

    //
    // Style the Run button based on solution legality == operator placement legality && mech initial placement legality
    //
    function isRunnable() {
        // impurity by dependencies: operatorStates, mechInitPosition, programs
        if (!isOperatorPlacementLegal()) {
            console.log("> simulation not runnable because of operator placement illegality");
            return false;
        }
        if (!isMechInitialPlacementLegal()) {
            console.log("> simulation not runnable because of mech initial placement illegality");
            return false;
        }

        for (const program of programs) {
            const instructions = program.split(",") as string[];
            if (instructions.length > PROGRAM_SIZE_MAX) return false;
        }

        return true;
    }

    //
    // Definition of setting DOM state
    //
    function setVisualForStates(atomStates: AtomState[], mechStates: MechState[], states: UnitState[][]) {
        let newStates = JSON.parse(JSON.stringify(states)); // duplicate

        for (const atom of atomStates) {
            newStates = setAtomVisualForStates(atom, newStates);
        }
        for (const mech of mechStates) {
            newStates = setMechVisualForStates(mech, newStates);
        }

        newStates = setConfigVisualForStates(newStates);

        return newStates;
    }

    //
    // Definition of setting mech's visual to DOM state
    //
    function setMechVisualForStates(mech: MechState, states: UnitState[][]) {
        // duplicate
        let newStates: UnitState[][] = JSON.parse(JSON.stringify(states));

        // if this mech is positioned illegally, don't render it
        if (isGridOOB(mech.index, DIM)) {
            return newStates;
        }

        // newStates[mech.index.x][mech.index.y].unit_id = mech.id;
        if (mech.status == MechStatus.OPEN) {
            newStates[mech.index.x][mech.index.y].border_status = BorderStatus.SINGLETON_OPEN;
        } else {
            newStates[mech.index.x][mech.index.y].border_status = BorderStatus.SINGLETON_CLOSE;
        }
        return newStates;
    }

    //
    // Definition of setting atom's visual to DOM state
    //
    function setAtomVisualForStates(atom: AtomState, states: UnitState[][]) {
        let newStates: UnitState[][] = JSON.parse(JSON.stringify(states)); // duplicate
        newStates[atom.index.x][atom.index.y].unit_id = atom.id;
        newStates[atom.index.x][atom.index.y].unit_text = UnitText.EMPTY;

        // TODO: refactor the following code
        if (atom.status == AtomStatus.FREE) {
            if (atom.typ == AtomType.VANILLA) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_VANILLA_FREE;
            } else if (atom.typ == AtomType.HAZELNUT) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_HAZELNUT_FREE;
            } else if (atom.typ == AtomType.CHOCOLATE) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_CHOCOLATE_FREE;
            } else if (atom.typ == AtomType.TRUFFLE) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_TRUFFLE_FREE;
            } else if (atom.typ == AtomType.SAFFRON) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_SAFFRON_FREE;
            } else if (atom.typ == AtomType.TURTLE) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_TURTLE_FREE;
            } else if (atom.typ == AtomType.SANDGLASS) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_SANDGLASS_FREE;
            } else if (atom.typ == AtomType.WILTED) {
                newStates[atom.index.x][atom.index.y].bg_status = BgStatus.ATOM_WILTED_FREE;
            }
        }
        return newStates;
    }

    //
    // Function to check operator placement validity
    // Note: surfaced by Dham playtesting in Lisbon prior to the MovyMovy talk
    //
    function isOperatorPlacementLegal() {
        // impurity by dependencies: operatorStates, constants such as faucet and sink positions

        if (!operatorStates) return false;
        if (isAnyOperatorPositionInvalid(operatorStates)) return false;

        for (const operator of operatorStates) {
            if (isOperatorPositionInvalid(operator)) return false;
        }

        return true;
    }

    //
    // Function to check mech initial placement validity
    //
    function isMechInitialPlacementLegal() {
        for (const pos of mechInitPositions) {
            if (isGridOOB(pos, DIM)) return false;
        }
        return true;
    }

    //
    // Definition of setting config's visual to DOM state (operators, faucets, sinks)
    //
    function setConfigVisualForStates(states: UnitState[][]) {
        let newStates = JSON.parse(JSON.stringify(states)); // duplicate

        // Faucet & Sink
        for (const faucet_pos of FAUCET_POS_S) {
            newStates[faucet_pos.x][faucet_pos.y].unit_text = UnitText.FAUCET;
        }

        for (const sink_pos of SINK_POS_S) {
            newStates[sink_pos.x][sink_pos.y].unit_text = UnitText.SINK;
        }

        // Operators
        if (operatorStates && !isAnyOperatorPositionInvalid(operatorStates)) {
            for (const operator of operatorStates) {
                if (isOperatorPositionInvalid(operator)) continue;

                for (const grid of operator.input) {
                    newStates[grid.x][grid.y].unit_text = operator.typ.symbol;
                }
                for (const grid of operator.output) {
                    newStates[grid.x][grid.y].unit_text = UnitText.OUTPUT;
                }
            }
        }

        return newStates;
    }

    function isAnyOperatorPositionInvalid(operators: Operator[]): boolean {
        // Check that the current adder's a,b,z + faucet's loc + sink's loc + all other operators' locs are all unique values,
        // otherwise, return true (adder position invalid)
        // note: Set() works for primitive types, hence stringify index object into string
        var adder_indices_in_str = [];
        operators.forEach(function (operator: Operator) {
            for (const grid of operator.input) {
                if (isNaN(grid.x) || isNaN(grid.y)) return false;
                adder_indices_in_str = [...adder_indices_in_str, JSON.stringify(grid)];
            }
            for (const grid of operator.output) {
                if (isNaN(grid.x) || isNaN(grid.y)) return false;
                adder_indices_in_str = [...adder_indices_in_str, JSON.stringify(grid)];
            }
        });

        let faucet_sink_indices_in_str = SINK_POS_S.map((sink_pos) => JSON.stringify(sink_pos));
        faucet_sink_indices_in_str.concat( FAUCET_POS_S.map((faucet_pos) => JSON.stringify(faucet_pos)) );

        const all_indices = adder_indices_in_str.concat(faucet_sink_indices_in_str);
        const unique_indices = all_indices.filter(onlyUnique);

        // if unique operation reduces array length, we have duplicate indices
        if (all_indices.length != unique_indices.length) {
            return true;
        }

        return false;
    }

    function onlyUnique(value, index, self) {
        return self.indexOf(value) === index;
    }

    function isOperatorPositionInvalid(operator: Operator): boolean {
        const grid_array = operator.input.concat(operator.output);
        for (const grid of grid_array) {
            if (isGridOOB(grid, DIM)) return true;
        }

        // Each operator grid needs to be neighbor with the next grid
        return Array.from({ length: grid_array.length - 1 }).some((_, i) => {
            return !areGridsNeighbors(grid_array[i], grid_array[i + 1]);
        });
    }

    // Handle click event for adding/removing mechs
    function handleMechClick(mode: string) {
        if (animationState != "Stop") return; // only when in Stop mode can player add/remove mechs
        if (mode === "+" && numMechs < MAX_NUM_MECHS) {
            setMechInitPositions(
                (prev) => {
                    let prev_copy: Grid[] = JSON.parse(JSON.stringify(prev));
                    prev_copy.push({ x: 0, y: 0 });
                    return prev_copy;
                }
            );
            setPrograms((prev) => {
                let prev_copy = JSON.parse(JSON.stringify(prev));
                prev_copy.push(INIT_PROGRAM);
                return prev_copy;
            });
            setMechDescriptions((prev) => {
                let prev_copy = JSON.parse(JSON.stringify(prev));
                prev_copy.push(INIT_DESCRIPTION);
                return prev_copy;
            });
        }
    }

    // Handle click even for addming/removing Adder (operator)
    function handleOperatorClick(mode: string, typ: string) {
        if (mode === "+" && numOperators < MAX_NUM_OPERATORS) {
            setPlacingFormula({ type: typ, grids: [] });
        } else if (mode === "-" && numOperators > 0) {
            setOperatorStates((prev) => {
                let prev_copy: Operator[] = JSON.parse(JSON.stringify(prev));
                prev_copy.pop();
                return prev_copy;
            });
        }
    }

    //
    // Handle click event for submitting solution to StarkNet
    //
    function handleClickSubmit() {
        if (!account) {
            console.log("> wallet not connected yet");
        }

        console.log("> connected address:", String(address));

        // submit tx
        console.log("> submitting args to simulator() on StarkNet:", calls);
        execute();

        return;
    }

    //
    // Handle click event for animation control
    //
    function handleClick(mode: string) {
        if (mode == "NextFrame" && animationState != "Run") {
            if (!frames) return;
            setAnimationFrame((prev) => (prev < N_CYCLES ? prev + 1 : prev));
        } else if (mode == "PrevFrame" && animationState != "Run") {
            if (!frames) return;
            setAnimationFrame((prev) => (prev > 0 ? prev - 1 : prev));
        }

        // Run simulation
        else if (mode == "ToggleRun") {
            // If in Run => go to Pause
            if (animationState == "Run") {
                clearInterval(loop); // kill the timer
                setAnimationState("Pause");
            }

            // If in Pause => resume Run without simulation
            else if (animationState == "Pause") {
                // Begin animation
                setAnimationState("Run");
                setLoop(
                    setInterval(() => {
                        simulationLoop(frames);
                    }, ANIM_FRAME_LATENCY)
                );
            }

            // If in Stop => perform simulation then go to Run
            else if (animationState == "Stop" && runnable) {
                // Parse program into array of instructions and store to react state
                let instructionSets = programsToInstructionSets(programs);
                console.log("running instructionSets", instructionSets);

                // Prepare input
                const boardConfig: BoardConfig = {
                    dimension: DIM,
                    atom_faucets: FAUCET_POS_S.map((faucet_pos, index) => {
                        return {
                            id: `atom_faucet${index}`,
                            typ: AtomType.VANILLA,
                            index: { x: faucet_pos.x, y: faucet_pos.y }
                        }
                    }),
                    atom_sinks: SINK_POS_S.map((sink_pos, index) => {
                        return {
                            id: `atom_sink${index}`,
                            index: { x: sink_pos.x, y: sink_pos.y },
                        };
                    }),
                    operators: operatorStates,
                };

                // Run simulation to get all frames and set to reference
                const simulatedFrames = simulator(
                    N_CYCLES, // n_cycles,
                    mechInitStates,
                    atomInitStates,
                    instructionSets, // instructions
                    boardConfig
                ) as Frame[];
                setFrames(simulatedFrames);

                simulatedFrames.forEach((f: Frame, frame_i: number) => {
                    // const s = f.atoms.map(function(v){return JSON.stringify(v)}).join('\n')
                    // console.log(frame_i, f.atoms)
                    // console.log(frame_i, f.notes)
                });
                const final_delivery = simulatedFrames[simulatedFrames.length - 1].delivered_accumulated;

                // Begin animation
                setAnimationState("Run");
                setLoop(
                    setInterval(() => {
                        simulationLoop(simulatedFrames);
                    }, ANIM_FRAME_LATENCY)
                );
                // console.log('Running with instruction:', instructions)
            }
        } else {
            // Stop
            clearInterval(loop); // kill the timer
            setAnimationState("Stop");
            setAnimationFrame(() => {
                return 0;
            });
        }
    }

    function setOperator(operator_i: number, new_operator: Operator) {
        setOperatorStates((prev) => {
            let prev_copy = JSON.parse(JSON.stringify(prev));
            prev_copy[operator_i] = new_operator;
            return prev_copy;
        });
    }

    const simulationLoop = (frames: Frame[]) => {
        setAnimationFrame((prev) => {
            if (prev >= frames.length - 1) {
                return 0;
            } else {
                return prev + 1;
            }
        });
    };

    function handleSlideChange(evt) {
        if (animationState == "Run") return;

        const slide_val: number = parseInt(evt.target.value);
        setAnimationFrame(slide_val);
    }

    function handleMouseOver(i: number, j: number) {
        const gridString: [string, string] = [i.toString(), j.toString()];
        setGridHovering(gridString);
    }

    function handleMouseOut() {
        setGridHovering(["-", "-"]);
    }

    function handleLoadSolutionClick(viewSolution: Solution) {

        if (animationState != "Stop") setAnimationState(_ => "Stop")
        setViewSolution((prev) => viewSolution);

        // set mode to arena
        setCurrMode(_ => Modes.arena);

        // set react states to render the solution on the board
        setPrograms((prev) => viewSolution.programs);
        setMechInitPositions((prev) => viewSolution.mechs.map((mech) => mech.index));
        setMechDescriptions((prev) => viewSolution.mechs.map((mech) => mech.description));
        setOperatorStates((prev) => viewSolution.operators);
        setAnimationFrame((prev) => 0);
        setFrames(_ => null);
    }

    function handleMouseOverOperatorInput(operator_i: number) {
        let newHighlight = Array(numOperators).fill(false);

        newHighlight[operator_i] = true;

        setOperatorInputHighlight((prev) => newHighlight);
    }

    function handleMouseOutOperatorInput(operator_i: number) {
        let newHighlight = [];
        for (let i = 0; i < numOperators; i++) {
            newHighlight.push(false);
        }
        setOperatorInputHighlight((prev) => newHighlight);
    }

    function handleUnitClick(x: number, y: number) {
        if (!placingFormula) return;

        setPlacingFormula((prev) => {
            const newPlacingFormula = { ...prev, grids: [...prev.grids, { x, y }] };
            const operator = placingFormulaToOperator(newPlacingFormula);

            // Check validity of operator
            if (operator.output.length > operator.typ.output_atom_types.length) return prev;
            if (isAnyOperatorPositionInvalid([...operatorStates, operator])) return prev;
            if (isOperatorPositionInvalid(operator)) return prev;

            const complete = operator.output.length === operator.typ.output_atom_types.length;

            return { ...newPlacingFormula, complete };
        });
    }

    function handleConfirmFormula() {
        setOperatorStates((prev) => [...prev, placingFormulaToOperator(placingFormula)]);
        setPlacingFormula(null);
    }

    function handleLoadModeClick(mode: Modes) {
        // mode can be 'arena' or any of ['lesson_1', 'lesson_2', ...]
        setCurrMode(_ => mode)

        // reset frames
        setFrames(_ => null)

        // reset various states
        setPrograms(_ => BLANK_SOLUTION.programs);
        setMechInitPositions(_ => BLANK_SOLUTION.mechs.map((mech) => mech.index));
        setMechDescriptions(_ => BLANK_SOLUTION.mechs.map((mech) => mech.description));
        setOperatorStates(_ => viewSolution.operators);
        setAnimationFrame(_ => 0);
        setOperatorStates(_ => BLANK_SOLUTION.operators);
        setPlacingFormula(_ => null);
    }

    // Lazy style objects
    const makeshift_button_style = { marginLeft: "0.2rem", marginRight: "0.2rem", height: "1.5rem" };
    const makeshift_run_button_style = runnable
        ? makeshift_button_style
        : { ...makeshift_button_style, color: "#CCCCCC" };

    const loadSave = (
        <LoadSave
            onLoadSolutionClick={handleLoadSolutionClick}
            mechInitStates={mechInitStates}
            operatorStates={operatorStates}
            programs={programs}
        />
    );

    const board = <Board
        mode={currMode}
        operatorStates = {operatorStates}
        operatorInputHighlight = {operatorInputHighlight}
        placingFormula = {placingFormula}
        unitStates = {unitStates}
        consumableAtomTypes = {consumableAtomTypes}
        produceableAtomTypes = {produceableAtomTypes}
        mechStates = {mechStates}
        atomStates = {atomStates}
        mechIndexHighlighted = {mechIndexHighlighted}
        handleMouseOver = {(x,y) => handleMouseOver(x,y)}
        handleMouseOut = {() => handleMouseOut()}
        handleUnitClick = {(x,y) => handleUnitClick(x,y)}
        consumedAtomIds = {consumedAtomIds}
        producedAtomIds = {producedAtomIds}
    />

    const stats = (
        <div>
            {" "}
            <div className={styles.delivered_atoms}>
                <Delivery delivered={delivered} cost_accumulated={cost_accumulated} />
            </div>
            <div className={styles.summary}>
                <Summary frames={frames} n_cycles={N_CYCLES} />
            </div>
        </div>
    );

    const mechProgramming = (
        <div>
            <MechProgramming
                animationState={animationState}
                mechCarries={mech_carries}
                mechIndexHighlighted={mechIndexHighlighted}
                mechInitPositions={mechInitPositions}
                mechDescriptions={mechDescriptions}
                mechStates={mechStates}
                onMechInitPositionsChange={setMechInitPositions}
                onMechDescriptionChange={setMechDescriptions}
                onMechIndexHighlight={setMechIndexHighlighted}
                onProgramsChange={setPrograms}
                programs={programs}
            />
            <Box sx={{ display: "flex", flexDirection: "row", marginTop: "0.6rem", marginLeft: "0.3rem" }}>
                {/* <Button color="secondary" variant="outlined" onClick={() => handleMechClick("+")}>
                    {t("newMech")}
                </Button> */}
                <button onClick={() => handleMechClick("+")}>{t("newMech")}</button>
            </Box>
        </div>
    );

    const formulaProgramming = (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", flexDirection: "row" }}>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "STIR")}>
                    {t("newOperation", { operation: "&" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "SHAKE")}>
                    {t("newOperation", { operation: "%" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "STEAM")}>
                    {t("newOperation", { operation: "^" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "SMASH")}>
                    {t("newOperation", { operation: "#" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "EVOLVE")}>
                    {t("newOperation", { operation: "§" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "SLOW")}>
                    {t("newOperation", { operation: "|" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "WILT")}>
                    {t("newOperation", { operation: "~" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("+", "BAKE")}>
                    {t("newOperation", { operation: "!" })}
                </button>
                <button style={makeshift_button_style} onClick={() => handleOperatorClick("-", "")}>
                    {t("removeOp")}
                </button>
            </Box>

            {placingFormula && (
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                    <FormulaBlueprint
                        placing
                        operatorType={OPERATOR_TYPES[placingFormula.type]}
                        grids={placingFormula.grids}
                    />
                    <button
                        // variant="outlined"
                        // color="secondary"
                        onClick={handleConfirmFormula}
                        disabled={!placingFormula.complete}
                        className={placingFormula.complete ? 'button_glow' : ''}
                    >
                        {placingFormula.complete ? t("confirmFormula") : t("placeFormula")}
                    </button>
                </Box>
            )}

            <Box>
                {Array.from({ length: numOperators }).map((_, operator_i) => (
                    <div
                        key={`input-row-${operator_i}`}
                        className={styles.input_row}
                        onMouseOver={() => handleMouseOverOperatorInput(operator_i)}
                        onMouseOut={() => handleMouseOutOperatorInput(operator_i)}
                        style={{
                            backgroundColor: operatorInputHighlight[operator_i]
                                ? theme.palette.primary.main
                                : operatorStates[operator_i].typ.color + "55",
                        }}
                    >
                        <p className={styles.input_name}>{t(operatorStates[operator_i].typ.name)}</p>

                        {Array.from({ length: operatorStates[operator_i].input.length }).map((_, input_i) => (
                            <div key={`input-row-${operator_i}-input-${input_i}`} className={styles.input_grid}>
                                {input_i == 0 ? (
                                    <p style={{ textAlign: "right" }} className={styles.input_text}>
                                        {operatorStates[operator_i].typ.symbol}(
                                    </p>
                                ) : (
                                    <></>
                                )}
                                <input
                                    className={styles.program}
                                    onChange={(event) => {
                                        // if (event.target.value.length == 0) return;
                                        // if (isNaN(parseInt(event.target.value))) return;
                                        let newOperator = JSON.parse(JSON.stringify(operatorStates[operator_i]));
                                        newOperator.input[input_i].x = parseInt(event.target.value);
                                        setOperator(operator_i, newOperator);
                                    }}
                                    defaultValue={operatorStates[operator_i].input[input_i].x}
                                    value={
                                        !isNaN(operatorStates[operator_i].input[input_i].x)
                                            ? operatorStates[operator_i].input[input_i].x
                                            : ""
                                    }
                                    style={{
                                        width: "30px",
                                        height: "25px",
                                        textAlign: "center",
                                        border: "1px solid #CCCCCC",
                                        borderRadius: "10px 0 0 10px",
                                    }}
                                    disabled={animationState == "Stop" ? false : true}
                                ></input>
                                <input
                                    className={styles.program}
                                    onChange={(event) => {
                                        // if (event.target.value.length == 0) return;
                                        // if (isNaN(parseInt(event.target.value))) return;
                                        let newOperator = JSON.parse(JSON.stringify(operatorStates[operator_i]));
                                        newOperator.input[input_i].y = parseInt(event.target.value);
                                        setOperator(operator_i, newOperator);
                                    }}
                                    defaultValue={operatorStates[operator_i].input[input_i].y}
                                    value={
                                        !isNaN(operatorStates[operator_i].input[input_i].y)
                                            ? operatorStates[operator_i].input[input_i].y
                                            : ""
                                    }
                                    style={{
                                        width: "30px",
                                        height: "25px",
                                        textAlign: "center",
                                        border: "1px solid #CCCCCC",
                                        borderLeft: "0px",
                                        borderRadius: "0 10px 10px 0",
                                    }}
                                    disabled={animationState == "Stop" ? false : true}
                                ></input>
                                {input_i == operatorStates[operator_i].input.length - 1 ? (
                                    <p className={styles.input_text}>{`)=`}</p>
                                ) : (
                                    <p className={styles.input_text}>{", "}</p>
                                )}
                            </div>
                        ))}

                        {Array.from({ length: operatorStates[operator_i].output.length }).map((_, output_i) => (
                            <div key={`input-row-${operator_i}-input-${output_i}`} className={styles.input_grid}>
                                <input
                                    className={styles.program}
                                    onChange={(event) => {
                                        // if (event.target.value.length == 0) return;
                                        let newOperator = JSON.parse(JSON.stringify(operatorStates[operator_i]));
                                        newOperator.output[output_i].x = parseInt(event.target.value);
                                        setOperator(operator_i, newOperator);
                                    }}
                                    defaultValue={operatorStates[operator_i].output[output_i].x}
                                    value={
                                        !isNaN(operatorStates[operator_i].output[output_i].x)
                                            ? operatorStates[operator_i].output[output_i].x
                                            : ""
                                    }
                                    style={{
                                        width: "30px",
                                        height: "25px",
                                        textAlign: "center",
                                        border: "1px solid #CCCCCC",
                                        borderRadius: "10px 0 0 10px",
                                    }}
                                    disabled={animationState == "Stop" ? false : true}
                                ></input>
                                <input
                                    className={styles.program}
                                    onChange={(event) => {
                                        // if (event.target.value.length == 0) return;
                                        let newOperator = JSON.parse(JSON.stringify(operatorStates[operator_i]));
                                        newOperator.output[output_i].y = parseInt(event.target.value);
                                        setOperator(operator_i, newOperator);
                                    }}
                                    defaultValue={operatorStates[operator_i].output[output_i].y}
                                    value={
                                        !isNaN(operatorStates[operator_i].output[output_i].y)
                                            ? operatorStates[operator_i].output[output_i].y
                                            : ""
                                    }
                                    style={{
                                        width: "30px",
                                        height: "25px",
                                        textAlign: "center",
                                        border: "1px solid #CCCCCC",
                                        borderLeft: "0px",
                                        borderRadius: "0 10px 10px 0",
                                    }}
                                    disabled={animationState == "Stop" ? false : true}
                                ></input>
                                {output_i != operatorStates[operator_i].output.length - 1 && (
                                    <p className={styles.input_text}>{`,`}</p>
                                )}
                            </div>
                        ))}
                    </div>
                ))}
            </Box>
        </Box>
    );

    // Render
    return (
        <>
            <Head>
                <title>MuMu</title>
                <meta name="MuMu" content="Generated by create next app" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <Layout
                loadSave={loadSave}
                board={board}
                stats={stats}
                mechProgramming={mechProgramming}
                formulaProgramming={formulaProgramming}
                midScreenControlProps = {{
                    runnable: runnable,
                    animationFrame: animationFrame,
                    n_cycles: N_CYCLES,
                    animationState: animationState,
                }}
                midScreenControlHandleClick={handleClick}
                midScreenControlHandleSlideChange={handleSlideChange}
                indexHandleClickSubmit={handleClickSubmit}
                loadSolution={handleLoadSolutionClick}
                loadMode={handleLoadModeClick}
                handleArenaModeClick={() => setCurrMode(_ => Modes.arena)}
            />
        </>
    );
}
