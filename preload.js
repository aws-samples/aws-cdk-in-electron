// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const sdk = require('aws-sdk');
const cdk = require('aws-cdk-lib');
const cxapi = require('@aws-cdk/cx-api')
const cfDeployments = require('aws-cdk/lib/api/cloudformation-deployments')
// const cfDeployments = require('aws-cdk/lib/api/deployments')
const bootstrap = require('aws-cdk/lib/api/bootstrap')
const cdkVersion = require('aws-cdk/lib/version');
const SdkProvider = require('aws-cdk/lib/api/aws-auth');
const { rootPath } = require('electron-root-path');
const path = require('path');
const fs = require("fs");
const { contextBridge } = require('electron');

const stacks = {};

process.versions['cdk'] = cdkVersion.DISPLAY_VERSION;
process.versions['sdk'] = sdk.VERSION;

//set default region
const REGION = process.env.AWS_DEFAULT_REGION || 'us-east-1';
sdk.config.update({ region: REGION });

function openInBrowser(url) {
  require('electron').shell.openExternal(url);
}
contextBridge.exposeInMainWorld('openInBrowser', (url) => openInBrowser(url))
/* 
* When the user submits credentials in the UI, this gets called
*/
function setCredentials(data, callback) {
  try {
    let rows = data.split("\n");
    if (rows.length < 2) {
      // Need at least 3 rows of data
      callback(new Error("You haven't supplied sufficient information in either the pasted credentials or the supplied key and secret. Please check your inputs and try again."))
    }
    else {
      /* 
      * Parse the input text and find the credentials. 
      * NB we don't know if these creds are valid until we check them using 
      * sts.getCallerIdentity further down
      */
      let envVars = {};
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].match(/AWS_ACCESS_KEY_ID/)) {
          let accessKey = rows[i].split('=')[1].replace(/\W/, '').substring(0, 20)
          if (rows[i].includes(accessKey)) {
            process.env['AWS_ACCESS_KEY_ID'] = envVars.AWS_ACCESS_KEY_ID = accessKey
          }
          else {
            console.log("parsed 'AWS_ACCESS_KEY_ID' didn't match input")
            console.log(rows[i])
            console.log(accessKey)
          }
        }
        else if (rows[i].match(/AWS_SECRET_ACCESS_KEY/)) {
          let secretKey = rows[i].split('=')[1].replace(/[^\w/+]/, '').substring(0, 40)
          if (rows[i].includes(secretKey)) {
            process.env['AWS_SECRET_ACCESS_KEY'] = secretKey
            envVars.AWS_SECRET_ACCESS_KEY = secretKey.split('').map(x => "*").join('')
          }
          else {
            console.log("parsed 'AWS_SECRET_ACCESS_KEY' didn't match input")
            console.log(rows[i])
            console.log(secretKey)
          }
        }
        else if (rows[i].match(/AWS_SESSION_TOKEN/)) {
          let sessToken = rows[i].replace(/.+?=/, '').replace(/[^\w/+=]/, '')
          if (rows[i].includes(sessToken)) {
            process.env['AWS_SESSION_TOKEN'] = sessToken
            // envVars.AWS_SESSION_TOKEN = sessToken.split('').map(x => sessToken.charAt(Math.round(Math.random() * sessToken.length))).join('')
          }
          else {
            console.log("parsed 'AWS_SESSION_TOKEN' didn't match input")
            console.log(rows[i])
            console.log(sessToken)
          }
        }
      }
      // console.log(envVars)
      if (envVars.hasOwnProperty('AWS_ACCESS_KEY_ID') && envVars.hasOwnProperty('AWS_SECRET_ACCESS_KEY')) {
        // Let's see if the credentials work
        let sts = new sdk.STS()
        sts.getCallerIdentity((err, data) => {
          if (err) {
            console.log(err)
            callback(new Error("Unable to create a session with the current supplied credentials."))
          }
          else {
            // console.log(data)
            envVars.AWS_ACCOUNT_ID = process.env.CDK_DEFAULT_ACCOUNT = data.Account
            let identityArn = data.Arn.split(':')
            envVars.IDENTITY = identityArn.pop()
            envVars.SDK_VERSION = sdk.VERSION;
            callback(null, envVars)
          }
        })
      }
      else {
        callback(new Error("Wasn't able to parse valid credentials from pasted text!"))
      }
    }
  }
  catch (e) {
    console.log(e);
    callback(new Error("Credential processing failed: " + JSON.stringify(e)))
  }
}

contextBridge.exposeInMainWorld('setCredentials', (data, cb) => setCredentials(data, cb))


/* 
* Once we have credentials, find the regions that are available to this identity
*/
function getRegions(callback) {
  let ec2 = new sdk.EC2();
  ec2.describeRegions(function (err, data) {
    if (err) {
      console.log(err, err.stack); // an error occurred
      callback(err, null);
    }
    else {
      callback(null, data);
    }
  })
}
contextBridge.exposeInMainWorld('getRegions', (cb) => getRegions(cb))

/* 
* When the user chooses a new region in the UI, this gets called
*/
function setRegion(region) {
  console.log("resetting SDK to region " + region)
  sdk.config.update({ region: region });
  process.env.AWS_DEFAULT_REGION = process.env.CDK_DEFAULT_REGION = region;
}

contextBridge.exposeInMainWorld('setRegion', (region) => setRegion(region))

/* 
* Once we have credentials, there are some things we can do with SDK
*/
function listBuckets(callback) {
  let s3 = new sdk.S3({ apiVersion: '2006-03-01' })
  s3.listBuckets(callback);
}
contextBridge.exposeInMainWorld('listBuckets', (cb) => listBuckets(cb))


/* 
* Poll for updates for stacks we're monitoring
*/
function getStackEvents(stackName, callback) {
  let cloudFormation = new sdk.CloudFormation();
  console.log("trying to get stack events for " + stackName);
  try {
    cloudFormation.describeStackEvents({ StackName: stackName },
      function (err, data) {
        if (err) {
          console.warn(err); // an error occurred
        }
        else {
          console.log(data.StackEvents);
          callback(stackName, data.StackEvents[0]);    // successful response
        }
      });
  }
  catch (e) {
    console.log(e);
  }
}
contextBridge.exposeInMainWorld('getStackEvents', (stack, cb) => getStackEvents(stack, cb))

/* 
* Get info for stacks we're monitoring
*/
function getStackInfo(stackName, callback) {
  let cloudFormation = new sdk.CloudFormation();
  console.log("trying to get stack info for " + stackName);
  try {
    cloudFormation.describeStacks({ StackName: stackName },
      function (err, data) {
        if (err) {
          console.warn(err); // an error occurred
          callback(stackName, err);
        }
        else {
          console.log(data);
          callback(stackName, data);    // successful response
        }
      });
  }
  catch (e) {
    console.log(e);
  }
}
contextBridge.exposeInMainWorld('getStackInfo', (stack, cb) => getStackInfo(stack, cb))

/* 
* Once we have credentials, find the regions that are available to this identity
*/
function getCfnTemplates(callback) {
  let templates = [];
  fs.readdir(path.join(rootPath, 'cfn-templates'), (err, files) => {
    if (err)
      console.log(err);
    else {
      files.forEach(file => {
        if (file.match(/.json$/)) {
          templates.push(file);
        }
      })
    }
    callback(templates);
  })
}
contextBridge.exposeInMainWorld('getCfnTemplates', (cb) => getCfnTemplates(cb))
/* 
* We can deploy pre-defined CFN templates that we bundle into the app via SDK
*/
function deployCloudFormationTemplate(template, callback) {
  console.log("deploying " + template);
  let templateBody = fs.readFileSync(__dirname + '/cfn-templates/' + template, 'utf-8');
  let cloudformation = new sdk.CloudFormation();
  let stackName = template.replace(/(.json|.yaml|.yml)/, '') + "-stack";
  stacks[stackName] = { hasOutputs: JSON.parse(templateBody).hasOwnProperty("Outputs") };
  try {
    let params = {
      StackName: stackName,
      Capabilities: ['CAPABILITY_NAMED_IAM'],
      TemplateBody: templateBody
    }
    cloudformation.createStack(params, callback);
  }
  catch (e) {
    delete stacks[stackName];
  }
}
contextBridge.exposeInMainWorld('deployCloudFormationTemplate', (template, cb) => deployCloudFormationTemplate(template, cb))

/* 
* CDK-related functions are defined here
* We can bootstrap an account and region
*/
async function bootstrapCdk(account, region, callback) {
  console.log('running bootstrapCdk for ' + "aws://" + account + "/" + region)
  const sdkProvider = await SdkProvider.SdkProvider.withAwsCliCompatibleDefaults({
    profile: process.env.AWS_PROFILE,
  })
  const bootstrapper = new bootstrap.Bootstrapper({ 'source': 'default' })
  bootstrapper.bootstrapEnvironment({ name: 'electron-bootstrapper', account: account, region: region }, sdkProvider).then((result) => callback(null, result), (failure) => callback(failure, null))
}
contextBridge.exposeInMainWorld('bootstrapCdk', (account, region, cb) => bootstrapCdk(account, region, cb))

/* 
* This function synths the CDK app and returns the stack template
*/
const getStackArtifact = (app, stack) => {
  const synthesized = app.synth();

  // Reload the synthesized artifact for stack using the cxapi from dependencies
  const assembly = new cxapi.CloudAssembly(synthesized.directory);

  return cxapi.CloudFormationStackArtifact.fromManifest(
    assembly,
    stack.artifactId,
    synthesized.getStackArtifact(stack.artifactId).manifest
  );
};

/* 
* This function creates a basic CDK app that creates an S3 bucket
*/
async function createCdkStack(account, region, bucketName, callback) {

  let app = new cdk.App()
  let stackName = bucketName + '-stack'
  let stack = new cdk.Stack(app, stackName, {
    env: {
      region: region,
      account: account
    }
  })
  stacks[stackName] = { hasOutputs: true };

  // console.log(sdk.config)
  let bucket = new cdk.aws_s3.Bucket(stack, bucketName.replace(/\-(\w)/g, RegExp.$1.toUpperCase()), {
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    bucketName: bucketName,
    blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
    autoDeleteObjects: true,
  });

  stack.exportValue(bucket.bucketName)

  // console.log(SdkProvider)
  const sdkProvider = await SdkProvider.SdkProvider.withAwsCliCompatibleDefaults({
    profile: process.env.AWS_PROFILE,
  })
  const cloudFormation = new cfDeployments.CloudFormationDeployments({ sdkProvider });
  let stackArtifact = getStackArtifact(app, stack);

  // console.log(stackArtifact)
  try {
    cloudFormation.deployStack({
      stack: stackArtifact,
      quiet: false,
    }).then((result) => callback(null, result, stackName), (failure) => callback(failure, null, stackName));
    console.log(stacks);
  }
  catch (e) {
    console.log(e)
    delete stacks[stackName];
    callback(e, null)
  }
}
contextBridge.exposeInMainWorld('createCdkStack', (account, region, bucketName, cb) => createCdkStack(account, region, bucketName, cb))

function getStacksInProgress() {
  return stacks;
}
contextBridge.exposeInMainWorld('getStacksInProgress', () => getStacksInProgress())

/* 
* This function creates a CDK app that builds an app deployment pipeline for bundled zipped cdk apps
*/
async function createCdkAppPipelineStack(account, region, callback) {

  let app = new cdk.App()
  let stack = new cdk.Stack(app, 'cdk-app-delivery-pipeline-stack', {
    env: {
      region: region,
      account: account
    }
  })
  stacks[stack.stackName] = { hasOutputs: false };
  let codepipelinePolicyJson = {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AllowAdminAccess",
        "Effect": "Allow",
        "Action": "*",
        "Resource": "*"
      }
    ]
  };
  //get the codepipeline policy document if one exists
  if (fs.existsSync(path.join(rootPath, 'pipeline-assets/codepipeline-service-role-policy.json'))) {
    codepipelinePolicyJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'pipeline-assets/codepipeline-service-role-policy.json'),
      { encoding: 'utf8', flag: 'r' }));
  }
  else {
    console.log("Running CodePipeline as admin - provide a least-privileges codepipeline-service-role-policy.json in the pipeline-assets/ folder of this project.")
  }

  const codepipelineManagedPolicy = new cdk.aws_iam.ManagedPolicy(stack, "CodepipelineManagedPolicy", {
    document: cdk.aws_iam.PolicyDocument.fromJson(codepipelinePolicyJson)
  });
  const codepipelineServiceRole = new cdk.aws_iam.Role(stack, "CodepipelineServiceRole", {
    assumedBy: new cdk.aws_iam.ServicePrincipal('codepipeline.amazonaws.com'),
    managedPolicies: [codepipelineManagedPolicy]
  })

  const apps = [];
  // console.log(path.join(rootPath, 'apps'))
  fs.readdir(path.join(rootPath, 'apps'), (err, files) => {
    if (err)
      console.log(err);
    else {
      files.forEach(file => {
        if (file.match(/.zip$/)) {
          apps.push(file);
          // console.log(file);
        }
      })
    }
    if (apps.length > 0) {
      console.log("Found apps to install:");
      console.log(apps);
    }
    else {
      console.log("Found no apps to install!")
    }

    const appPaths = [];

    for (let i = 0; i < apps.length; i++) {
      // console.log(apps[i])
      let codebuildPolicyJson = {
        "Version": "2012-10-17",
        "Statement": [
          {
            "Sid": "AllowAdminAccess",
            "Effect": "Allow",
            "Action": "*",
            "Resource": "*"
          }
        ]
      };

      //override the policy document if one exists
      if (fs.existsSync(path.join(rootPath, 'apps', apps[i].replace('.zip', '.json')))) {
        let manifestJson = JSON.parse(fs.readFileSync(path.join(rootPath, 'apps', apps[i].replace('.zip', '.json')),
          { encoding: 'utf8', flag: 'r' }));
        // console.log("overriding default policy for " + apps[i]);
        console.log(manifestJson);
        codebuildPolicyJson = manifestJson.CodeBuildPolicy;
        for (let i = 0; i < manifestJson.Stacks.length; i++) {
          stacks[manifestJson.Stacks[i].name] = { hasOutputs: manifestJson.Stacks[i].hasOutputs };
        }
        console.log(stacks);
      }
      else {
        console.log(apps[i] + " - running CodeBuild as admin - it's preferable to provide a JSON policy document for " + apps[i] + " instead.")
      }

      let codebuildPolicyDocument = cdk.aws_iam.PolicyDocument.fromJson(codebuildPolicyJson);

      let artifactBucket = new cdk.aws_s3.Bucket(stack, "ArtifactBucket" + i, {
        blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
        autoDeleteObjects: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      })

      let pipeline = new cdk.aws_codepipeline.Pipeline(stack, "CodePipeline" + i, {
        artifactBucket: artifactBucket,
        restartExecutionOnUpdate: true,
        role: codepipelineServiceRole
      })

      let sourceOutput = new cdk.aws_codepipeline.Artifact()

      appPaths[i] = new cdk.aws_s3_assets.Asset(stack, 'AppAsset' + i, {
        path: path.join(rootPath, 'apps', apps[i]),
      });
      // console.log(appPaths)

      let sourceAction = new cdk.aws_codepipeline_actions.S3SourceAction({
        actionName: 'S3Source' + i,
        bucketKey: appPaths[i].s3ObjectKey,
        bucket: appPaths[i].bucket,
        output: sourceOutput,
        trigger: cdk.aws_codepipeline_actions.S3Trigger.NONE,
      });

      pipeline.addStage({ stageName: "Source", actions: [sourceAction] })

      let buildOutput = new cdk.aws_codepipeline.Artifact();

      let codebuildServiceRole = new cdk.aws_iam.Role(stack, "CodebuildServiceRole" + i, {
        assumedBy: new cdk.aws_iam.ServicePrincipal('codebuild.amazonaws.com'),
        managedPolicies: [new cdk.aws_iam.ManagedPolicy(stack, "CodebuildManagedPolicy" + i, {
          document: codebuildPolicyDocument
        })]
      })

      let buildProject = new cdk.aws_codebuild.PipelineProject(stack, "BuildProject" + i, {
        buildSpec: cdk.aws_codebuild.BuildSpec.fromSourceFilename("buildspec.yml"), environment: {
          buildImage: cdk.aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
          privileged: true,
        },
        role: codebuildServiceRole
      })

      pipeline.addStage({
        stageName: "Build",
        actions: [new cdk.aws_codepipeline_actions.CodeBuildAction({
          actionName: "Build",
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput]
        })]
      });
    }

    // console.log(appPaths);
    const paths = []
    for (let i = 0; i < apps.length; i++) {
      paths.push({
        bucket: appPaths[i].bucket,
        objectPrefix: appPaths[i].s3ObjectKey,
      })
    }
    // console.log(paths);
    /* 
    * You could configure the pipeline to run when files change in the S3 bucket
    */
    // const trail = new cdk.aws_cloudtrail.Trail(stack, 'CloudTrail');
    // trail.addS3EventSelector(paths, {
    //   readWriteType: cdk.aws_cloudtrail.ReadWriteType.WRITE_ONLY,
    // });
  })

  // console.log(SdkProvider)
  const sdkProvider = await SdkProvider.SdkProvider.withAwsCliCompatibleDefaults({
    profile: process.env.AWS_PROFILE,
  })
  const cloudFormation = new cfDeployments.CloudFormationDeployments({ sdkProvider });
  let stackArtifact = getStackArtifact(app, stack);

  try {
    cloudFormation.deployStack({
      stack: stackArtifact,
      quiet: false,
    }).then((result) => callback(null, result, stack.stackName), (failure) => callback(failure, null, stack.stackName))
  }
  catch (e) {
    console.log(e)
    delete stacks[stack.stackName];
    callback(e, null, stack.stackName)
  }
}
contextBridge.exposeInMainWorld('createCdkAppPipelineStack', (account, region, cb) => createCdkAppPipelineStack(account, region, cb))


/* 
* Reset the UI and list of tracked stacks
*/
function clearTrackedStacks() {
  for (const key in stacks) {
    delete stacks[key];
  }
}
contextBridge.exposeInMainWorld('clearTrackedStacks', () => clearTrackedStacks())

/*
* preps the page, from Electron quickstart https://www.electronjs.org/docs/latest/tutorial/quick-start
* Licensed under the MIT License
*/
window.addEventListener('DOMContentLoaded', () => {

  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron', 'cdk', 'sdk']) {
    replaceText(`${type}-version`, process.versions[type])
  }

})
