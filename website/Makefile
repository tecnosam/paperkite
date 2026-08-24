.PHONY: bump-major bump-minor bump-patch tag

SCRIPTS := ../scripts

# Bumps package.json's version (via `npm version`, without creating a git
# commit or tag), then stamps the new version into CHANGELOG.md.
bump-major:
	@$(MAKE) _bump PART=major
bump-minor:
	@$(MAKE) _bump PART=minor
bump-patch:
	@$(MAKE) _bump PART=patch

_bump:
	@NEW=$$(npm version $(PART) --no-git-tag-version | tr -d 'v'); \
	$(SCRIPTS)/bump-changelog.sh CHANGELOG.md $$NEW; \
	echo "website bumped to $$NEW"

# Tags HEAD as website-v<version> (from package.json), doesn't push.
tag:
	@VERSION=$$(node -p "require('./package.json').version"); \
	$(SCRIPTS)/tag-release.sh website $$VERSION .
