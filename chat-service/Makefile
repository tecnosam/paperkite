.PHONY: proto build run run-client run-ops update-ops clean test test-unit test-integration bump-major bump-minor bump-patch tag docker

GITHUB_REPO ?= tecnosam/paperkite

PROTO_DIR  := proto
GEN_DIR    := gen
PROTO_FILE := $(PROTO_DIR)/chat/chat.proto
SCRIPTS    := ../scripts

proto:
	@echo "Generating protobuf and gRPC code..."
	protoc \
		--go_out=$(GEN_DIR) --go_opt=paths=source_relative \
		--go-grpc_out=$(GEN_DIR) --go-grpc_opt=paths=source_relative \
		-I $(PROTO_DIR) \
		$(PROTO_FILE)

build:
	go build ./...

run:
	go run ./cmd/server

# Interactive CLI client for manually exercising a running server. Example:
#   make run-client ARGS='-url https://example.com/room -username alice'
run-client:
	go run ./cmd/chat $(ARGS)

# The deploy-webhook daemon (see internal/ops and cmd/ops). Separate
# process from `run` above - it launches and manages the app server
# itself, so don't run both against the same ports at once. Needs
# OPS_JWT_SECRET set (deliberately different from CHAT_JWT_SECRET); the
# app it launches inherits this process's whole environment, so
# CHAT_JWT_SECRET etc. still need setting here too. Example:
#   OPS_JWT_SECRET=... CHAT_JWT_SECRET=... make run-ops
run-ops:
	go run ./cmd/ops

# Run this ON THE SERVER (as root) to update the ops daemon itself - it
# has no self-update mechanism, so this is a separate manual step from
# the normal /deploy webhook, which only ever updates chat-service-server.
# See deploy/update-ops.sh for what it actually does. Usage:
#   make update-ops                            # latest chat-service-v* release
#   make update-ops TAG=chat-service-v0.1.1    # a specific tag
update-ops:
	@GITHUB_REPO=$(GITHUB_REPO) bash deploy/update-ops.sh $(TAG)

# Unit tests: fast, no external dependencies, no build tags required.
test-unit:
	go test -race -count=1 ./internal/...

# Integration tests: spins up in-process servers, requires CHAT_JWT_SECRET only
# within the test itself (set via t.Setenv). No external services needed.
test-integration:
	go test -race -count=1 -tags integration -timeout 30s ./test/integration/...

# Run all tests.
test: test-unit test-integration

clean:
	rm -rf $(GEN_DIR)/chat/*.pb.go

# Bumps the version in VERSION, then stamps it into CHANGELOG.md.
bump-major:
	@$(MAKE) _bump PART=major
bump-minor:
	@$(MAKE) _bump PART=minor
bump-patch:
	@$(MAKE) _bump PART=patch

_bump:
	@NEW=$$($(SCRIPTS)/bump-version.sh VERSION $(PART)); \
	$(SCRIPTS)/bump-changelog.sh CHANGELOG.md $$NEW; \
	echo "chat-service bumped to $$NEW"

# Tags HEAD as chat-service-v<version> (from VERSION), doesn't push.
# Triggers .github/workflows/release-chat-service.yml once pushed.
tag:
	@VERSION=$$(cat VERSION); \
	$(SCRIPTS)/tag-release.sh chat-service $$VERSION .

# Local Docker build, same Dockerfile CI uses.
docker:
	docker build -t paperkite-chat-service:local .
