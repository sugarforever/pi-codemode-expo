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
   update the native checkout SHA and archive version in `verify.yml`. Commit the
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
