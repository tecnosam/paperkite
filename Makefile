.PHONY: help \
	browser-bump-major browser-bump-minor browser-bump-patch browser-tag \
	chat-service-bump-major chat-service-bump-minor chat-service-bump-patch chat-service-tag \
	website-bump-major website-bump-minor website-bump-patch website-tag

help:
	@echo "Release flow, per component (this is a monorepo, each one versions"
	@echo "and releases independently):"
	@echo ""
	@echo "  1. make <component>-bump-patch   (or -minor / -major)"
	@echo "     Bumps the version file and moves CHANGELOG.md's [Unreleased]"
	@echo "     section under a dated heading. No git side effects."
	@echo "  2. review/commit the bump, e.g. git commit -am 'browser: v1.0.1'"
	@echo "  3. make <component>-tag"
	@echo "     Creates an annotated tag '<component>-vX.Y.Z' at HEAD. Prints"
	@echo "     the push command, doesn't push it."
	@echo "  4. git push origin <component>-vX.Y.Z"
	@echo "     This is what actually triggers the release workflow - it"
	@echo "     only builds the component named in the tag, not all three."
	@echo ""
	@echo "  make browser-bump-major       make browser-bump-minor       make browser-bump-patch       make browser-tag"
	@echo "  make chat-service-bump-major  make chat-service-bump-minor  make chat-service-bump-patch  make chat-service-tag"
	@echo "  make website-bump-major       make website-bump-minor       make website-bump-patch       make website-tag"
	@echo ""
	@echo "Each can also be run directly inside its own directory, e.g."
	@echo "'cd browser && make bump-patch'."

browser-bump-major:
	@$(MAKE) -C browser bump-major
browser-bump-minor:
	@$(MAKE) -C browser bump-minor
browser-bump-patch:
	@$(MAKE) -C browser bump-patch
browser-tag:
	@$(MAKE) -C browser tag

chat-service-bump-major:
	@$(MAKE) -C chat-service bump-major
chat-service-bump-minor:
	@$(MAKE) -C chat-service bump-minor
chat-service-bump-patch:
	@$(MAKE) -C chat-service bump-patch
chat-service-tag:
	@$(MAKE) -C chat-service tag

website-bump-major:
	@$(MAKE) -C website bump-major
website-bump-minor:
	@$(MAKE) -C website bump-minor
website-bump-patch:
	@$(MAKE) -C website bump-patch
website-tag:
	@$(MAKE) -C website tag
