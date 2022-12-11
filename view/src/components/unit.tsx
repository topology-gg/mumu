import Grid from "../types/Grid";
import UnitState, { BgStatus, BorderStatus } from "../types/UnitState";
import styles from "../../styles/Unit.module.css";
import { useSpring, animated } from "react-spring";
import { AnimationRounded } from "@mui/icons-material";
import { useRef } from 'react'
import { AtomType } from "../types/AtomState";

interface UnitProps {
    atomOpacity?: number;
    state: UnitState;
    consumableAtomType: AtomType;
    produceableAtomType: AtomType;
    handleMouseOver: () => void;
    handleMouseOut: () => void;
    mechHighlight: boolean;
    isSmall: boolean;
    onClick?: () => void;
    isConsumed: boolean;
    isProduced: boolean;
}

export default function Unit({
    atomOpacity,
    state,
    consumableAtomType,
    produceableAtomType,
    handleMouseOver,
    handleMouseOut,
    mechHighlight,
    isSmall,
    onClick,
    isConsumed,
    isProduced,
}: UnitProps) {

    // guardrail
    if (!state) {
        return <></>;
    }

    // animation prop
    const animationStyle = isSmall ? useSpring({}) :
    isConsumed ? useSpring({
        from: {backgroundSize: 28.8}, // 90% of 32px is 28.8px
        backgroundSize: 0,
        config: {friction: 50}
    }) :
    isProduced ? useSpring({
        from: {backgroundSize: 0},
        backgroundSize: 28.8,
        config: {friction: 40}
    }) :
    useSpring({
        backgroundSize: 28.8
    })

    // Compute atom styles
    let divStyle: React.CSSProperties = mechHighlight ? { borderWidth: "3px"} : { borderWidth: "1px"};
    if (isSmall) divStyle = { ...divStyle, width: "1.6rem", height: "1.6rem" };
    divStyle = { ...divStyle, zIndex: "20" };

    let className: string = '';
    if (state.bg_status === BgStatus.ATOM_VANILLA_FREE || (isConsumed && consumableAtomType === AtomType.VANILLA)) {
        className += styles.atomVanillaFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_HAZELNUT_FREE || (isConsumed && consumableAtomType === AtomType.HAZELNUT)) {
        className += styles.atomHazelnutFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_CHOCOLATE_FREE || (isConsumed && consumableAtomType === AtomType.CHOCOLATE)) {
        className += styles.atomChocolateFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_TRUFFLE_FREE || (isConsumed && consumableAtomType === AtomType.TRUFFLE)) {
        className += styles.atomTruffleFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_SAFFRON_FREE || (isConsumed && consumableAtomType === AtomType.SAFFRON)) {
        className += styles.atomSaffronFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_TURTLE_FREE || (isConsumed && consumableAtomType === AtomType.TURTLE)) {
        className += styles.atomTurtleFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_SANDGLASS_FREE || (isConsumed && consumableAtomType === AtomType.SANDGLASS)) {
        className += styles.atomSandglassFree + " ";
    }
    else if (state.bg_status === BgStatus.ATOM_WILTED_FREE || (isConsumed && consumableAtomType === AtomType.WILTED)) {
        className += styles.atomWiltedFree + " ";
    }

    const mechId = state.unit_id && state.unit_id.includes("mech") && state.unit_id.replace("mech", "");

    // Render
    return (
        <animated.div
            className={`grid ${styles.unit} ${className}`}
            onMouseOver={handleMouseOver}
            onMouseOut={handleMouseOut}
            onClick={onClick}
            style={{
                ...divStyle,
                ...animationStyle,
                opacity: atomOpacity || 1.0
            }}
        >
            {state.unit_text}
        </animated.div>
    );
}
