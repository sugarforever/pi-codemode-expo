# Releasing pi-codemode-expo

## One-time setup

1. Publish the required `expo-quickjs` version first.
2. Publish the first adapter version manually using the verified GitHub Actions
   `npm-package` artifact. For the experimental 0.1.0 release:

   ```sh
   npm publish ./pi-codemode-expo-0.1.0.tgz --access public --tag next
   ```

3. Configure npm trusted publishing for `pi-codemode-expo`:
   GitHub owner `sugarforever`, repository `pi-codemode-expo`, workflow filename
   `publish.yml`, environment `npm`, allowed action `publish`.

   ```sh
   npm trust github pi-codemode-expo \
     --repo sugarforever/pi-codemode-expo \
     --file publish.yml --env npm --allow-publish --yes
   ```

   This requires npm 11.15+ and may require interactive account authentication.
   The equivalent settings are available on the package's npm settings page.
4. Create a matching GitHub prerelease `v0.1.0`. The workflow verifies the package
   again and skips publication only if npm already holds identical archive bytes.
   Different bytes under the same version fail; npm versions cannot be overwritten.

## Subsequent versions

1. Implement changes and update release notes. If changing native compatibility,
   first release the native package, update `peerDependencies.expo-quickjs`, and
   update the native checkout SHA and archive version in `verify.yml` and the
   native-peer version check in `publish.yml`. Commit the
   corresponding lockfile changes. Keep deterministic identity/protocol policy
   compatible or deliberately change the fingerprint so old runs refuse replay.
2. Bump the adapter version without creating a tag yet:

   ```sh
   npm version patch --no-git-tag-version
   # Choose minor or major instead when the change requires it.
   git add package.json package-lock.json
   git commit -m "Release pi-codemode-expo 0.1.1"
   git push origin HEAD:main
   ```

3. Wait for `Verify adapter package` on that exact commit to pass. It builds and
   tests native QuickJS, runs adapter and real SQLite replay tests, checks types,
   and reruns tests against packed artifacts in a clean consumer.
4. Publish a GitHub release with the exact version tag. For example:

   ```sh
   gh release create v0.1.1 --repo sugarforever/pi-codemode-expo \
     --target <verified-commit-sha> --title "pi-codemode-expo 0.1.1" \
     --notes-file release-notes.md --prerelease
   ```

   Use `--prerelease` while experimental. Omit it for an intended stable release.
   GitHub prereleases and semver prerelease versions publish to npm `next`;
   ordinary GitHub releases publish to npm `latest`.
5. Watch `Publish to npmjs` complete, then verify:

   ```sh
   npm view pi-codemode-expo@0.1.1 version dist.integrity
   npm view pi-codemode-expo dist-tags
   ```

After trusted publishing is configured, no manual npm login or long-lived token
is needed for these future releases. Pushing a commit or a tag alone does not
publish; the published GitHub release event triggers publication. Failed runs can
be rerun: the registry-integrity check skips an identical existing publication.

Current acceptance: iOS Hermes smoke and host native/SQLite restart tests pass.
Android, physical devices, and mobile SQLite restart remain unverified. Update
`docs/verification.md` when additional platform evidence becomes available.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm trust CLI](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## npm setup timing and first-package processing

npm can accept the first publish and display a temporary `0.0.0-stage` placeholder
while processing it. Do not repeatedly publish the same version. Wait until the
requested version appears and verify its `dist.integrity` against the CI artifact;
`npm stage list <package>` distinguishes visible staged approvals from processing.

A newly created trusted-publisher connection must make its **first successful
CI publication within two days**, or npm expires it. An initial release workflow
that skips an identical manually published version does not validate the connection.
The adapter connection was created on 2026-10-20. Its first automated publication,
`0.2.0`, was accepted through GitHub Actions on the same day with signed provenance,
satisfying this initial setup condition. See the [successful publication run](https://github.com/sugarforever/pi-codemode-expo/actions/runs/39459724336). See npm's [configuration expiry policy](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry).


The pinned native engine revision's host test transport has a shutdown EPIPE race.
CI installs a versioned host-only fixture and runs its regression before native
facade tests. Native VM and published package source are unchanged. Remove this
fixture when updating to a native revision containing the upstream test fix.

## Recovering a release after a workflow fix

If a workflow bug prevents publication, fix the workflow on `main` without moving
the published version tag. Retry using the current workflow against the existing
GitHub release:

```sh
gh workflow run publish.yml --ref main -f release-tag=v0.2.0
```

This rebuilds and tests the tagged source, reads the existing release's prerelease
status, validates its package version, and publishes the verified archive. The
same integrity guard prevents overwriting an existing version with different bytes.
