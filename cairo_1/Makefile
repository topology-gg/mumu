TEST_ENTRYPOINT = .
ENTRYPOINT = src/

.PHONY: format

format: 
	cairo-format -r $(ENTRYPOINT)

test:
	cairo-test --path $(TEST_ENTRYPOINT)