const fs = require("node:fs")

// Errors raised intentionally by the action, with single-line messages that
// are safe to emit as workflow command annotations.
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

if (require.main === module) {
    try {
        runAction()
    } catch (err) {
        if (err instanceof ActionError) {
            console.log(`::error::${err.message}`)
        } else {
            console.log(err)
            console.log("::error::Unknown error")
        }
        process.exitCode = 1
    }
}

module.exports = { runAction, ActionError }
