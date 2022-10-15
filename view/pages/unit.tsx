import {useState, useEffect, useRef, CSSProperties} from 'react';
import UnitState, {BgStatus, BorderStatus} from '../src/types/UnitState';
import styles from '../styles/Unit.module.css';

export default function Unit({state, typ}: {state: UnitState, typ: string}) {

    // Compute style based on props (from parent's React state)
    let className: string = '';
    if (state.bg_status === BgStatus.ATOM_VANILLA_FREE) {
        className = styles.atomVanillaFree;
    }
    else if (state.bg_status === BgStatus.ATOM_VANILLA_POSSESSED) {
        className = styles.atomVanillaPossessed;
    }

    if (state.border_status == BorderStatus.SINGLETON_OPEN) {
        className = styles.mechSingletonOpen;
    }
    else if (state.border_status == BorderStatus.SINGLETON_CLOSE) {
        className = styles.mechSingletonClose;
    }

    var text: string;
    if (typ == 'faucet') {
        text = 'F'
    }
    else if (typ == 'sink') {
        text = 'S'
    }
    else {
        text = '·'
    }

    // Render
    return (
        <div className={`grid ${styles.unit} ${className}`}>{text}</div>
    )
}
