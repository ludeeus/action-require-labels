const fs = require("fs");

function runAction() {
    let eventData;
    const eventPath = process.env.GITHUB_EVENT_PATH

    if (eventPath && fs.existsSync(eventPath)) {
        eventData = JSON.parse(fs.readFileSync(eventPath, {encoding: 'utf8'}))
    } else {
        throw new Error(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    if (!eventData.pull_request) {
        throw new Error("This is not a pull request.")
    }

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new Error("No labels defined on the pull request.")
    }

    const inputLabels = process.env.INPUT_LABELS
    
    if (!inputLabels) {
        throw new Error("No required labels defined for the action.")
    }

    const requiredLabels = new Set(inputLabels.split(",").map(label => label.trim()))
    const prLabels = eventData.pull_request.labels.map(label => label.name)

    console.log(`Required labels ${requiredLabels}`)
    console.log(`Pull request labels ${prLabels}`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request`)
    
    if (matchingLabels.length === 0) {
        throw new Error("No matching required labels found.");
    }
}


runAction();
