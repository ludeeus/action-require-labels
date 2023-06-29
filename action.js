const fs = require("fs");

function runAction() {
    const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH))
    if (!eventData.pull_request) {
        throw new Error("This is not a pull request.")
    }

    if (!eventData.pull_request.labels || eventData.pull_request.labels.lenght === 0) {
        throw new Error("No labels defined on the pull request.")
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)
    console.log(prLabels)
}





runAction();