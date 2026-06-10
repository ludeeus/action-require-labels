const fs = require("node:fs")

class ActionError extends Error {}

function runAction() {
    const eventPath = process.env.GITHUB_EVENT_PATH

    if (!eventPath || !fs.existsSync(eventPath)) {
        throw new ActionError(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }))

    if (!eventData.pull_request) {
        throw new ActionError("This is not a pull request.")
    }

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new ActionError("No labels defined on the pull request.")
    }

    const inputLabels = process.env.INPUT_LABELS

    if (!inputLabels) {
        throw new ActionError("No required labels defined for the action.")
    }

    const requiredLabels = new Set(inputLabels.split(",").map(label => label.trim()).filter(Boolean))

    if (requiredLabels.size === 0) {
        throw new ActionError("No required labels defined for the action.")
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)

    console.log(`Required labels (${Array.from(requiredLabels).join(",")})`)
    console.log(`Pull request labels (${prLabels.join(",")})`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${matchingLabels.join(",")})`)

    if (matchingLabels.length === 0) {
        throw new ActionError("No matching required labels found.")
    }
}

// Workflow command data must stay on a single line; see
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
function escapeData(data) {
    return data.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

if (require.main === module) {
    try {
        runAction()
    } catch (err) {
        if (err instanceof ActionError) {
            console.log(`::error::${escapeData(err.message)}`)
        } else {
            console.log(err)
            console.log("::error::Unknown error")
        }
        process.exitCode = 1
    }
}

module.exports = { runAction, ActionError }
