import AtomFaucetState from './AtomFaucetState'
import AtomSinkState from './AtomSinkState'
import BinaryOperator from './Operator'

export default interface BoardConfig {
    dimension: number
    atom_faucets: AtomFaucetState[]
    atom_sinks: AtomSinkState[]
    binary_operators: BinaryOperator[]
}
