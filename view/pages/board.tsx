import styles from "../styles/Home.module.css";
import React, { useState, useRef, useEffect, useMemo } from "react";
import MechState, { MechStatus, MechType } from "../src/types/MechState";
import Unit from "./unit";
import UnitState, { BgStatus, BorderStatus, UnitText } from "../src/types/UnitState";
import Grid from "../src/types/Grid";
import Operator, { OPERATOR_TYPES, PlacingFormula } from "../src/types/Operator";
import OperatorGridBg from "../src/components/OperatorGridBg";
import { DIM, PROGRAM_SIZE_MAX, DEMO_SOLUTIONS, N_CYCLES } from "../src/constants/constants";
import { useTranslation } from "react-i18next";
import "../config/i18n";
import { Box, Button, Tooltip } from "@mui/material";
import { ANIM_FRAME_LATENCY } from "../src/constants/constants";
import AtomState from "../src/types/AtomState";
import { useSpring, animated } from "react-spring";
import MechUnit from "../src/components/MechUnit"

interface BoardProps {
    operatorStates: Operator[]
    operatorInputHighlight: boolean[]
    placingFormula?: PlacingFormula
    unitStates: UnitState[][]
    mechStates: MechState[]
    atomStates: AtomState[]
    mechIndexHighlighted: number
    handleMouseOver: (x: number, y: number) => void
    handleMouseOut: () => void
    handleUnitClick: (x: number, y: number) => void
}

export default function Board (
    { operatorStates, operatorInputHighlight, placingFormula,
    unitStates, mechStates, atomStates, mechIndexHighlighted,
    handleMouseOver, handleMouseOut, handleUnitClick}: BoardProps) {

    // build mapping from mech_i to possessed atom (if any)
    var possessedAtom = mechStates.map(_ => null)
    for (const atomState of atomStates){
        if (atomState.possessed_by !== null){
            const mech_i: number = +atomState.possessed_by.replace('mech','')
            possessedAtom[mech_i] = atomState
        }
    }

    const BOARD_DIM: number = DIM*2 + (DIM+1)*0.2 + 4 // unit is rem; reflect the dimensions, padding and margin set in CSS
    const board = (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mt: "2rem" }}>
            <div
                className={styles.grid_parent}
                style={{
                    width: BOARD_DIM.toString()+'rem',
                    height: BOARD_DIM.toString()+'rem'
                }}
            >
                <OperatorGridBg
                    operators={operatorStates}
                    highlighted={operatorInputHighlight}
                    placingFormula={placingFormula}
                />

                {
                    mechStates.map((mechState, mech_i) => (
                        <MechUnit mechState={mechState} possessedAtom={possessedAtom[mech_i]}/>
                    ))
                }


                {Array.from({ length: DIM }).map(
                    (
                        _,
                        i // i is y
                    ) => (
                        <div key={`row-${i}`} className={styles.grid_row}>
                            {Array.from({ length: DIM }).map(
                                (
                                    _,
                                    j // j is x
                                ) => (
                                    <Tooltip title={`${j},${i}`} disableInteractive arrow>
                                        <div>
                                            <Unit
                                                key={`unit-${j}-${i}`}
                                                state={unitStates[j][i]}
                                                handleMouseOver={() => handleMouseOver(j, i)}
                                                handleMouseOut={() => handleMouseOut()}
                                                onClick={() => handleUnitClick(j, i)}
                                                mechHighlight={
                                                    mechIndexHighlighted == -1
                                                        ? false
                                                        : j == mechStates[mechIndexHighlighted].index.x &&
                                                          i == mechStates[mechIndexHighlighted].index.y
                                                        ? true
                                                        : false
                                                }
                                                isSmall={false}
                                            />
                                        </div>
                                    </Tooltip>
                                )
                            )}
                        </div>
                    )
                )}
            </div>
        </Box>
    );

    // Render
    return board;
}
