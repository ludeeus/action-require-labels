const fs = require("fs");

function runAction() {
    let eventData;
    const eventPath = process.env.GITHUB_EVENT_PATH
    const actionPath = process.env.GITHUB_ACTION_PATH

    if (eventPath && fs.existsSync(eventPath)) {
        eventData = JSON.parse(fs.readFileSync(eventPath, {encoding: 'utf8'}))
    } else {
        throw new Error(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    if (actionPath && fs.existsSync(actionPath)) {
        fs.readdirSync(actionPath).forEach(file => {
            console.log(file);
          });
    } else {
        throw new Error(`GITHUB_ACTION_PATH ${actionPath} does not exist`)
    }
      

    if (!eventData.pull_request) {
        throw new Error("This is not a pull request.")
    }

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new Error("No labels defined on the pull request.")
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)
    console.log(prLabels)
}





runAction();