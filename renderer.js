// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

let region = null
let account = null
let cfMonitor = null;
let stackStates = {};
let stackInfoRequestors = {};
let previousStatusReport = "";
let stackOutputs = {}
let debugMessages = {};
let bouncyBox = `<span class="la-square-jelly-box la-dark la-sm"><div></div><div></div></span>`;

document.documentElement.setAttribute('data-theme', 'light')
document.getElementById("create-bucket-with-cdk").value = "electron-cdk-created-bucket-" + Math.random().toString(36).slice(2, 10);

const cfnStates = function (stack, state) {
  let stacks = window.getStacksInProgress();
  stackStates[stack] = state;
  // if this is a stack event, check to see if the stack is complete
  if (state.LogicalResourceId === stack) {
    stacks[stack].status = state.ResourceStatus;
    // if stack is complete, request stack info to retrieve outputs, if applicable
    if (stacks[stack].status.match(/_COMPLETE/) && stacks[stack].hasOutputs) {
      stackInfoRequestors[stack] = setInterval(requestStackInfo, 5000, stack);
    }
  }
  updateStackEventDisplay(stacks)
}

const updateStackEventDisplay = function (stacks) {
  let cfDiv = document.getElementById('cf-stack-states');
  let htmlOutput = "";
  inProgressStacks = Object.keys(stacks).length;
  if (Object.keys(stackStates).length === 0) {
    htmlOutput = bouncyBox;
  }
  for (thisStack in stackStates) {
    htmlOutput += `<b>` + thisStack + "</b>: ";
    if (stackStates[thisStack].LogicalResourceId === thisStack) {
      htmlOutput += stackStates[thisStack].ResourceStatus + "<br/>";
      if (!stackStates[thisStack].ResourceStatus.match(/_COMPLETE/)) {
        htmlOutput += bouncyBox;
        console.log(`Will keep checking state for ${thisStack} as its state is ${stackStates[thisStack].ResourceStatus}`)
      }
      else {
        inProgressStacks = --inProgressStacks;
      }
    }
    else {
      htmlOutput += stackStates[thisStack].LogicalResourceId + ": " + stackStates[thisStack].ResourceStatus + "<br/>";
      htmlOutput += bouncyBox;
      console.log("event is for " + stackStates[thisStack].LogicalResourceId);
    }
    htmlOutput += ` (<a target="_blank" href="https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${stackStates[thisStack].StackId}">Console</a>)<br/>`;
  }

  if (previousStatusReport !== htmlOutput) {
    cfDiv.innerHTML = previousStatusReport = htmlOutput;
  }
  if (inProgressStacks === 0) {
    console.log("all stacks done");
    clearInterval(cfMonitor);
  }

  console.log(stackStates);
  console.log(stackInfoRequestors);
}

const cfnOutputs = function (stack, outputs) {
  // console.log("cfnOutputs for " + stack + ": " + JSON.stringify(outputs))
  if (outputs.Stacks[0].Outputs.length > 0) {
    //we have the outputs so kill off the requestor
    clearInterval(stackInfoRequestors[stack]);
  }
  stackOutputs[stack] = outputs;
  showOutputs();
}

const showOutputs = function () {
  let cfOutDiv = document.getElementById('cf-stack-outputs');
  let htmlOutputs = "";
  for (stack in stackOutputs) {
    if (stackOutputs[stack].hasOwnProperty("Stacks")) {
      htmlOutputs += "<b>" + stack + ":</b><br/>";
      for (let i = 0; i < stackOutputs[stack].Stacks[0].Outputs.length; i++) {
        htmlOutputs += "<b>" + stackOutputs[stack].Stacks[0].Outputs[i].OutputKey + "</b>: " + stackOutputs[stack].Stacks[0].Outputs[i].OutputValue + "<br>";
      }
    }
  }
  cfOutDiv.innerHTML = htmlOutputs;
}

const requestStackInfo = function (stack) {
  console.log("Getting outputs for " + stack);
  window.getStackInfo(stack, cfnOutputs)
}

const cfnMessages = function (failure, success, stackName) {
  if (!stackName) {
    if (success && success.hasOwnProperty("StackId")) {
      stackName = success.StackId.split('/')[1];
    }
    else {
      stackName = "Unknown";
    }
  }
  console.log("callback from cloudformation deploy")
  console.log(failure)
  console.log(success)
  if (failure) {
    debugMessages[stackName] = failure;
  }
  else {
    debugMessages[stackName] = success;
  }
  let htmlOutput = "";
  for (stack in debugMessages) {
    htmlOutput += `<b>${stack}</b>: ` + JSON.stringify(debugMessages[stack]) + "<br>";
  }
  document.getElementById('deploystack-output').innerHTML = htmlOutput;
}

function resetUi() {
  document.getElementById('credentials-block').hidden = false;
  document.getElementById('sdk-output').hidden = false;
  document.getElementById('loading-block').hidden = true;
  document.getElementById('commands-block').hidden = true;
  document.getElementById('error-block').hidden = true;
  document.getElementById('error-divider').hidden = true;
  document.getElementById('change-credentials-block').hidden = true;
}

resetUi();

function displayErrors(errorString) {
  if (errorString) {
    document.getElementById('errors').innerHTML = errorString;
    document.getElementById('error-block').hidden = false;
    document.getElementById('error-divider').hidden = false;
    document.getElementById('error-divider').scrollIntoView();
  }
  else {
    document.getElementById('errors').innerHTML = "";
    document.getElementById('error-block').hidden = true;
    document.getElementById('error-divider').hidden = true;
  }
}

function addCredentials() {
  let errors = "";
  let credentials = document.getElementById("pasted-credentials").value;
  if (document.getElementById("access-key-id").value && document.getElementById("secret-access-key").value) {
    credentials = "AWS_ACCESS_KEY_ID=" + document.getElementById("access-key-id").value + "\nAWS_SECRET_ACCESS_KEY=" + document.getElementById("secret-access-key").value + "\n";
  }
  // console.log(credentials);
  window.setCredentials(credentials, function (err, data) {
    if (err) {
      errors = err;
    } else {
      account = data.AWS_ACCOUNT_ID
      let credDisplay = "";
      for (let key in data) {
        credDisplay += "<b>" + key + "</b>: " + data[key] + "<br/>\n"
      }
      document.getElementById('debug').innerHTML = credDisplay;
      document.getElementById('credentials-block').hidden = true;
      document.getElementById('change-credentials-block').hidden = false;
      document.getElementById('loading-block').hidden = false;
      populateRegionsSelect()
    }
  })
  displayErrors(errors);
}

function getBuckets() {
  let errors = "";
  document.getElementById('errors').innerHTML = "";
  document.getElementById('errors').hidden = true;
  document.getElementById('sdk-output').hidden = false;
  try {
    window.listBuckets(function (err, data) {
      if (err) {
        console.log("Error", err);
        errors = JSON.stringify(err);
      } else {
        console.log("Success", data.Buckets);
        document.getElementById('sdk-output').hidden = false;
        let output = "";
        for (let i = 0; i < data.Buckets.length; i++) {
          output += "* " + data.Buckets[i].Name + "<br>\n";
        }
        document.getElementById('sdk-result').innerHTML = output;
      }
    })
  } catch (err) {
    console.log("Error", err);
    errors = JSON.stringify(err);
  }
  displayErrors(errors);
}

function bootstrapCdkApp() {
  window.bootstrapCdk(account, region, cfnMessages);
}

function createCdkStackFunc() {
  clearInterval(cfMonitor);
  window.createCdkStack(account, region, document.getElementById("create-bucket-with-cdk").value, cfnMessages);
  cfMonitor = setInterval(showStacksProgressFunc, 5000);
}

function createCdkAppPipelineStackFunc() {
  clearInterval(cfMonitor);
  window.createCdkAppPipelineStack(account, region, cfnMessages);
  cfMonitor = setInterval(showStacksProgressFunc, 5000);
}

function populateTemplateSelect() {
  window.getCfnTemplates((data) => {
    let sortedTemplates = data.sort();
    let templateSelect = document.getElementById('template-select')
    templateSelect.innerHTML = '';
    for (let i = 0; i < sortedTemplates.length; i++) {
      let option = document.createElement("option");
      option.text = sortedTemplates[i].replace(/.json/, "");
      option.value = sortedTemplates[i];
      templateSelect.add(option);
    }
  })
}

function deployCfnTemplate() {
  if (document.getElementById('template-select').value) {
    clearInterval(cfMonitor);
    window.deployCloudFormationTemplate(document.getElementById('template-select').value, cfnMessages);
    cfMonitor = setInterval(showStacksProgressFunc, 5000);
  }
}

function populateRegionsSelect() {
  window.getRegions((err, data) => {
    if (err) {
      console.error(err)
    }
    else {
      console.log(data.Regions)
      region = 'us-east-1';
      let regionSelect = document.getElementById('region-select')
      regionSelect.innerHTML = '';
      for (let i = 0; i < data.Regions.length; i++) {
        let option = document.createElement("option");
        option.text = data.Regions[i].RegionName;
        regionSelect.add(option);
      }
      regionSelect.value = region;
      document.getElementById('commands-block').hidden = false;
      document.getElementById('loading-block').hidden = true;
    }
  })
}

function updateRegion() {
  region = document.getElementById('region-select').value
  window.setRegion(region);
  console.log("region changed to " + region)
}

function showStacksProgressFunc() {
  let stacks = window.getStacksInProgress();
  console.log("checking stack progress for these stacks: " + JSON.stringify(stacks));
  for (stack in stacks) {
    window.getStackEvents(stack, cfnStates);
  }
}

populateTemplateSelect();

document.getElementById("region-select").addEventListener("change", updateRegion);
document.getElementById("change-credentials-button").addEventListener("click", resetUi);
document.getElementById("submit-credentials-button").addEventListener("click", addCredentials);
document.getElementById("get-buckets-button").addEventListener("click", getBuckets);
document.getElementById("bootstrap-cdk-button").addEventListener("click", bootstrapCdkApp);
document.getElementById("create-cdk-stack-button").addEventListener("click", createCdkStackFunc);
document.getElementById("create-cdk-app-pipeline-button").addEventListener("click", createCdkAppPipelineStackFunc);
document.getElementById("deploy-template-button").addEventListener("click", deployCfnTemplate);

