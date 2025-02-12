%lang starknet

from starkware.cairo.common.dict_access import DictAccess
from starkware.cairo.common.default_dict import default_dict_new, default_dict_finalize

from contracts.simulator.utils import check_uniqueness
from contracts.simulator.operators import verify_valid_operators
from contracts.simulator.grid import Grid

@external
func test_check_uniqueness{range_check_ptr}(
    operators_inputs_len: felt,
    operators_inputs: Grid*,
    operators_outputs_len: felt,
    operators_outputs: Grid*,
) {
    alloc_locals;
    let (local dict) = default_dict_new(default_value=0);
    let (dict_) = check_uniqueness(operators_inputs_len, operators_inputs, dict);
    let (dict_) = check_uniqueness(operators_outputs_len, operators_outputs, dict_);
    default_dict_finalize(dict_accesses_start=dict_, dict_accesses_end=dict_, default_value=0);
    return ();
}

@external
func test_verify_valid_operators{range_check_ptr}(
    piping_len: felt,
    piping: Grid*,
    operators_type_len: felt,
    operators_type: felt*,
    operators_inputs_len: felt,
    operators_inputs: Grid*,
    operators_outputs_len: felt,
    operators_outputs: Grid*,
    dimension: felt,
) {
    verify_valid_operators(
        piping_len,
        piping,
        operators_type_len,
        operators_type,
        operators_inputs_len,
        operators_inputs,
        operators_outputs_len,
        operators_outputs,
        dimension,
    );
    return ();
}
