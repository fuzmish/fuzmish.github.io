const fs = require("node:fs/promises");
const path = require("node:path");

async function main({ core, exec, github }) {
  const cwd = process.env.ROOT_DIR || process.cwd();
  const owner = process.env.REPOSITORY.split("/")[0];
  const repo = process.env.REPOSITORY.split("/")[1];
  const ref = `heads/${process.env.REF || "main"}`;
  const message = process.env.MESSAGE || "automated";

  const debug = false ? core.info.bind(core) : core.debug.bind(core); // for debug output

  // resolve base commit and tree
  const _parent = await github.rest.git.getRef({ owner, repo, ref });
  debug(`getRef -> ${JSON.stringify(_parent, null, 2)}`);
  const parent = _parent.data.object.sha;
  core.info(`Resolved ${ref} to commit ${parent}`);
  const _commit = await github.rest.git.getCommit({ owner, repo, commit_sha: parent });
  debug(`getCommit -> ${JSON.stringify(_commit, null, 2)}`);
  const base_tree = _commit.data.tree.sha;
  core.info(`Base tree is ${base_tree}`);

  // get staged changes
  const { stdout: diff } = await exec.getExecOutput(
    "git",
    ["diff", "--cached", "--no-renames", "--name-status"],
    { cwd },
  );
  debug(`git diff: ${diff}`)

  // create blobs
  const blobs = [];
  for (const line of diff.split("\n")) {
    const segments = line.trim().split("\t");
    if (segments.length !== 2) {
      continue;
    }
    const [status, file] = segments;
    if (status === "D") {
      // deleted
      blobs.push({ path: file, mode: "100644", type: "blob", sha: null });
    } else {
      // created or modified
      const content = (await fs.readFile(path.join(cwd, file))).toString("base64");
      const blob = await github.rest.git.createBlob({ owner, repo, content, encoding: "base64" });
      debug(`createBlob -> ${JSON.stringify(blob, null, 2)}`);
      blobs.push({ path: file, mode: "100644", type: "blob", sha: blob.data.sha });
    }
  }
  if (blobs.length === 0) {
    core.notice("No staged files, skip creating tree");
    return;
  }
  debug(`blobs: ${JSON.stringify(blobs, null, 2)}`);
  core.info(`Staged ${blobs.length} file(s)`);

  // create tree
  const _tree = await github.rest.git.createTree({ owner, repo, base_tree, tree: blobs });
  debug(`createTree -> ${JSON.stringify(_tree, null, 2)}`);
  const tree = _tree.data.sha;
  core.info(`Tree ${tree} created`);

  // create commit
  const commit = await github.rest.git.createCommit({ owner, repo, message, tree, parents: [parent] });
  debug(`createCommit -> ${JSON.stringify(commit, null, 2)}`);
  const sha = commit.data.sha;
  core.info(`Commit ${sha} created`);

  // update ref
  const _ref = await github.rest.git.updateRef({ owner, repo, ref, sha });
  debug(`updateRef -> ${JSON.stringify(_ref, null, 2)}`);
  core.info(`Ref ${_ref.data.ref} updated to ${_ref.data.object.sha}`);
}

module.exports = main;
