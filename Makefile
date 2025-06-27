# Binary name as defined in goreleaser.yaml
BINARY_NAME = scrapeless

# Default version (can be overridden with VERSION=x.y.z)
VERSION ?= v0.0.1

# Default output directory
DIST_DIR = dist

# Default target
.PHONY: all
all: build

# Build a snapshot release for all platforms (without publishing to GitHub)
.PHONY: build
build:
	@echo "Building snapshot release (multi-platform)..."
	GORELEASER_CURRENT_TAG=$(VERSION) goreleaser release --snapshot --clean

# Build the binary only for the current system (quick build)
.PHONY: build-local
build-local:
	@echo "Building local binary for current platform..."
	go build -ldflags "-X github.com/scrapeless-ai/scrapeless-cli/cmd.Version=$(VERSION)" -o $(BINARY_NAME) main.go

.PHONY: release
release:
ifndef GITHUB_TOKEN
	$(error "GITHUB_TOKEN is not set, please export it before running this command")
endif
	git fetch --tags
	LATEST_TAG=$$(git describe --tags `git rev-list --tags --max-count=1`) ; \
	echo "Releasing latest tag: $$LATEST_TAG" ; \
	goreleaser release --clean


# Clean up build artifacts and compiled binaries
.PHONY: clean
clean:
	@echo "Cleaning up dist/ and binary..."
	rm -rf $(DIST_DIR) $(BINARY_NAME)
