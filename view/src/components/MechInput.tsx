import React from "react";
import Grid from "../types/Grid";
import styles from "../../styles/Home.module.css";

interface MechInputProps {
    mechIndex: number;
    position: Grid;
    program: string;
    animationFrame: number;
    onPositionChange: (mechIndex: number, position: Grid) => void;
    onProgramChange: (mechIndex: number, program: string) => void;
}

const MechInput = ({
    mechIndex,
    position,
    program,
    animationFrame,
    onPositionChange,
    onProgramChange,
}: MechInputProps) => {
    const programLength = program.split(",").length;
    const currentInstructionIndex = animationFrame % programLength;
    return (
        <div key={`input-row-${mechIndex}`} className={styles.input_row}>
            <p
                style={{
                    margin: "0 10px 0 0",
                    verticalAlign: "middle",
                    height: "20px",
                    lineHeight: "20px",
                }}
            >{`mech${mechIndex}`}</p>
            <input
                className={styles.program}
                onChange={(event) => {
                    onPositionChange(mechIndex, {
                        ...position,
                        x: parseInt(event.target.value),
                    });
                }}
                defaultValue={position.x}
                style={{ width: "30px", textAlign: "center" }}
            ></input>

            <input
                className={styles.program}
                onChange={(event) => {
                    onPositionChange(mechIndex, {
                        ...position,
                        y: parseInt(event.target.value),
                    });
                }}
                defaultValue={position.y}
                style={{ width: "30px", textAlign: "center" }}
            ></input>
            <div className={styles.programWrapper}>
                <div
                    className={styles.instructionBox}
                    style={{ left: `${currentInstructionIndex}rem` }}
                />
                <input
                    className={styles.program}
                    onChange={(event) => {
                        onProgramChange(mechIndex, event.target.value);
                    }}
                    defaultValue={program}
                    style={{ width: "300px" }}
                ></input>
            </div>
        </div>
    );
};

export default MechInput;
