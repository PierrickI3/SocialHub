'use strict';

/*

Look at the README.md file for a more high-leve of this server.

This file contains the code to communicate between Smooch and Genesys PureCloud.
All conversation-related data is kept in an array called "conversationsMap", structured as follows:

[
    {
        smooch: {
            appId: '',              // Smooch integration app id
            conversationId: '',     // Smooch conversation id
            userId: '',             // External chat participant id
            firstName: '',          // First name of the external chat participant
            lastName: ''            // Last name of the external chat participant
        },
        purecloud: {
            conversationId: '',     // PureCloud conversation id
            webSocket: xxxxxx,      // NOT SURE YET. Reference to webSocket variable?
            externalUserId: '',     // PureCloud participant representing the Smooch side of the chat (not PureCloud agent)
            agentUserId: '',        // PureCloud agent participant,
            webSocket: <WEBSOCKET>  // Reference to webSocket variable
        }
   }
]

Events from Smooch and PureCloud are handled and the correct targets are found using the array above using dedicated functions.

*/

/*
    TODO

    . Pass first message from Facebook to PureCloud (says conversation is not active)
    . If smooch conversation id already exists in the conversationsMap array, try to get last agent. Need to save last agentUserId. Do it from Architect?
    . Can it work in Lambda or Heroku?
    . Implement typing activity: https://docs.smooch.io/rest/?javascript#conversation-activity
    . Age verification from Architect. 3rd party service or can get from Smooch?
    . Handle schedules in Architect
    . Disconnect the smooch conversation or send a message when PC agent disconnects?
    . How to know when to disconnect PureCloud conversation from Smooch?
    . How to easily support other providers?
    . How to get Facebook profile pic?
    . Update documentation

*/

//#region Imports

const express = require('express');
const bodyParser = require('body-parser');
const Smooch = require('smooch-core');
const request = require('request');
const WebSocket = require('ws');

//#endregion

//#region Config

const PORT = process.env.PORT || 8000;

const SMOOCH_KEYID = process.env.SMOOCH_KEYID || 'app_5dc32a436472c70010691d27';
const SMOOCH_SECRET = process.env.SMOOCH_SECRET || '3ZuI4afjVc5h1a1819BJrYh1LGi1ddqh7Pb5KTEYDTbznlzjGonrmYG7UAP1OVIwlYlqMlILMHrJaZOarw_S_A';

const PURECLOUD_ORGANIZATIONID = process.env.PURECLOUD_ORGANIZATIONID || '3b03b67a-2349-4a03-8b28-c8ac5c26c49a';
const PURECLOUD_DEPLOYMENTID = process.env.PURECLOUD_DEPLOYMENTID || '7ff41a97-03c6-498a-8266-237874b39c0c';
const PURECLOUD_QUEUENAME = process.env.PURECLOUD_QUEUENAME || 'AllAgents';
const PURECLOUD_ENVIRONMENT = process.env.PURECLOUD_ENVIRONMENT || 'mypurecloud.ie';

// Smooch

const smooch = new Smooch({
    keyId: SMOOCH_KEYID,
    secret: SMOOCH_SECRET,
    scope: 'app'
});

//#endregion

//#region Express

const app = express();
app.use(bodyParser.json());

//#endregion

var conversationsMap = [], jwtToken;

//#region Conversations Map functions

function addSmoochConversationToMap(smoochConversationId, smoochAppId, smoochUserId, firstName, lastName) {
    // Check if the conversation already exists in the mapping array
    let existingSmoochConversation = conversationsMap.filter(c => c.smooch.conversationId === smoochConversationId);
    console.log('Existing conversation:', existingSmoochConversation);

    if (existingSmoochConversation.length === 0) {
        // Add new conversation to mapping array
        conversationsMap.push({
            smooch: {
                appId: smoochAppId,
                conversationId: smoochConversationId,
                userId: smoochUserId,
                firstName: firstName,
                lastName: lastName
            }
        });
        console.log('Conversations Map:', conversationsMap);
    }
}

function updatePureCloudConversation(smoochConversationId, pureCloudConversationId, externalUserId, agentUserId, webSocket) {
    console.log(`Updating Smooch conversation (${smoochConversationId}) with PureCloud conversation id (${pureCloudConversationId}), PureCloud external user id (${externalUserId}) and PureCloud agent user id (${agentUserId})`);

    for (let index = 0; index < conversationsMap.length; index++) {
        var returnConversation = undefined;
        if (conversationsMap[index].smooch.conversationId === smoochConversationId) {
            if (!conversationsMap[index].hasOwnProperty('purecloud')) {
                conversationsMap[index].purecloud = {};
            }
            if (pureCloudConversationId) conversationsMap[index].purecloud.conversationId = pureCloudConversationId;
            if (externalUserId) conversationsMap[index].purecloud.externalUserId = externalUserId;
            if (agentUserId) conversationsMap[index].purecloud.agentUserId = agentUserId;
            if (webSocket) conversationsMap[index].purecloud.webSocket = webSocket;

            console.log(`Smooch conversation ${smoochConversationId} updated: ${JSON.stringify(returnConversation, null, 4)}`);
            returnConversation = conversationsMap[index];
            break;
        }
    }
    return returnConversation;
}

function clearPureCloudConversation(smoochConversationId) {
    console.log(`Clearing PureCloud Conversation from Smooch conversation (${smoochConversationId})`);

    for (let index = 0; index < conversationsMap.length; index++) {
        if (conversationsMap[index].smooch.conversationId === smoochConversationId) {
            if (conversationsMap[index].purecloud.webSocket) {
                conversationsMap[index].purecloud.webSocket.terminate();
            }
            conversationsMap[index].purecloud = {};
            
            console.log(`PureCloud conversation from Smooch conversation ${smoochConversationId} cleared`);
            break;
        }
    }
}

function getConversationBySmoochConversationId(smoochConversationId) {
    let conversation = conversationsMap.filter(c => c.smooch.conversationId === smoochConversationId);
    if (conversation) {
        return conversation[0];
    } else {
        return undefined;
    }
}

function getPureCloudMemberInfo(conversationId, memberId) {
    return new Promise((resolve, reject) => {
        let options = {
            url: `https://api.${PURECLOUD_ENVIRONMENT}/api/v2/webchat/guest/conversations/${conversationId}/members/${memberId}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `bearer ${jwtToken}`
            }
        };

        request(options, function (error, response, body) {
            if (error) {
                reject(error);
                return;
            }

            if (response.statusCode == 200) {
                resolve(JSON.parse(body));
            } else {
                reject(error);
            }
        });
    });
}

//#endregion

//#region Smooch

// This is where Smooch messages arrive (https://docs.smooch.io/rest/#webhooks-payload)
app.post('/messages', async (req, res) => {
    console.log('webhook PAYLOAD:\n', JSON.stringify(req.body, null, 4));

    try {
        if (req.body.trigger === 'message:appUser') {

            const smoochConversationId = req.body.conversation._id;
            const smoochAppId = req.body.app._id;
            const smoochUserId = req.body.appUser._id;
            const firstName = req.body.appUser.givenName;
            const lastName = req.body.appUser.surname;

            addSmoochConversationToMap(smoochConversationId, smoochAppId, smoochUserId, firstName, lastName);

            // Forward message to PureCloud
            let conversation = getConversationBySmoochConversationId(smoochConversationId);
            if (conversation.purecloud && conversation.purecloud.conversationId) {
                postPureCloudMessage(conversation.purecloud.conversationId, conversation.purecloud.externalUserId, req.body.messages[0].text, 'standard');
            } else {
                console.log('Creating new PureCloud chat...');
                createPureCloudChat(req.body.appUser.givenName, req.body.appUser.surname, smoochConversationId, req.body.messages[0].text);
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        res.end();
    }
});

// Posts a message to a Smooch conversation
function postSmoochMessage(smoochAppId, smoochUserId, message) {
    console.log(`====> TO SMOOCH: ${message} -> Smooch app id: ${smoochAppId}, Smooch user id: ${smoochUserId}`);
    smooch.appUsers.sendMessage({
        appId: smoochAppId,
        userId: smoochUserId,
        message: {
            text: message,
            role: 'appMaker', // appMaker => App to Facebook, appUser => App to PureCloud
            type: 'text'
        }
    }).then((response) => {
        console.log('API RESPONSE:\n', response);
    }).catch((err) => {
        console.log('API ERROR:\n', err);
    });
}

//#endregion

//#region PureCloud Chat

// Creates a PureCloud chat conversation
async function createPureCloudChat(firstName, lastName, smoochConversationId, initialMessage) {
    console.log(`createPureCloudChat(${firstName}, ${lastName}, ${smoochConversationId})`);

    let body = {
        "organizationId": PURECLOUD_ORGANIZATIONID,
        "deploymentId": PURECLOUD_DEPLOYMENTID,
        "routingTarget": {
            "targetType": "QUEUE",
            "targetAddress": PURECLOUD_QUEUENAME
        },
        "memberInfo": {
            "displayName": `${firstName} ${lastName}`,
            //"profileImageUrl": "http://amaovs.xp3.biz/img/photo/sample-image.jpg",
            "customFields": {
                "customField1Label": "First Name",
                "customField1": firstName,
                "customField2Label": "Last Name",
                "customField2": lastName
            }
        }
    };

    let options = {
        url: 'https://api.' + PURECLOUD_ENVIRONMENT + '/api/v2/webchat/guest/conversations',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };

    request(options, async (error, response, body) => {
        if (!error && response.statusCode == 200) {
            var info = JSON.parse(body);
            console.log('POST /guest/conversations response:', info);
            jwtToken = info.jwt; // JWT Token used for future requests
            updatePureCloudConversation(smoochConversationId, info.id, info.member.id);

            // Initiate WebSocket communication with PureCloud (only then will it queue the chat request)
            var webSocket = new WebSocket(info.eventStreamUri);
            updatePureCloudConversation(smoochConversationId, info.id, null, null, webSocket);

            webSocket.on('open', function () {
                console.log('WebSocket opened');


                // Post initial message from external user
                //postPureCloudMessage(info.id, info.member.id, initialMessage); // Says conversation is not active
            });

            webSocket.on('message', async (message) => {
                var messageData = JSON.parse(message);

                // Ignore WebSocket Heartbeat messages
                if (messageData.topicName === 'channel.metadata') {
                    return;
                }
                console.log('WebSocket Message:', messageData);

                var currentConversation = getConversationBySmoochConversationId(smoochConversationId);

                switch (messageData.metadata.type) {
                    case 'message':
                        switch (messageData.eventBody.bodyType) {
                            case 'member-join': // A new participant has joined the PureCloud chat conversation
                                await getPureCloudMemberInfo(messageData.eventBody.conversation.id, messageData.eventBody.sender.id).then((pureCloudMemberInfo) => {
                                    switch (pureCloudMemberInfo.role) {
                                        case 'AGENT':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Agent: ${pureCloudMemberInfo.displayName} has joined this conversation.`);
                                            break;
                                        case 'CUSTOMER':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Customer: ${pureCloudMemberInfo.displayName} has joined this conversation.`);
                                            break;
                                        case 'ACD':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `ACD: ${pureCloudMemberInfo.displayName} has joined this conversation.`);
                                            break;
                                        case 'WORKFLOW':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Workflow: ${pureCloudMemberInfo.displayName} has joined this conversation.`);
                                            break;
                                        default:
                                            console.warn(`Unknown role: ${memberRole}`)
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Unknown participant ${pureCloudMemberInfo.displayName} has joined this conversation.`);
                                            break;
                                    }
                                }).catch((error) => {
                                    console.error(error);
                                });

                                break;
                            case 'member-leave': // A participant has left the PureCloud chat conversation
                                await getPureCloudMemberInfo(messageData.eventBody.conversation.id, messageData.eventBody.sender.id).then((pureCloudMemberInfo) => {
                                    switch (pureCloudMemberInfo.role) {
                                        case 'AGENT':
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Agent: ${pureCloudMemberInfo.displayName} has left this conversation.`);
                                            break;
                                        case 'CUSTOMER':
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Customer: ${pureCloudMemberInfo.displayName} has left this conversation.`);
                                            break;
                                        case 'ACD':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `ACD: ${pureCloudMemberInfo.displayName} has left this conversation.`);
                                            break;
                                        case 'WORKFLOW':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Workflow: ${pureCloudMemberInfo.displayName} has left this conversation.`);
                                            break;
                                        default:
                                            console.warn(`Unknown role: ${memberRole}`);
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Unknown participant ${pureCloudMemberInfo.displayName} has left this conversation.`);
                                            break;
                                    }
                                }).catch((error) => {
                                    console.error(error);
                                });
                                break;
                            case 'standard':
                                // A message has been added to the chat. Use sender.id to identify the author of the message.
                                console.log(`Sender id ${messageData.eventBody.sender.id} === agentUserId ${currentConversation.purecloud.agentUserId}?`);
                                if (messageData.eventBody.sender.id === currentConversation.purecloud.agentUserId) {
                                    // This is a message coming from the PureCloud agent, send it to Smooch
                                    postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, messageData.eventBody.body);
                                }
                                break;
                            default:
                                console.log('Not handling bodyType:', messageData.eventBody.bodyType);
                                break;
                        }
                        break;
                    case 'typing-indicator':
                        //TODO
                        break;
                    case 'member-change':
                        // A participant state has changed
                        await getPureCloudMemberInfo(messageData.eventBody.conversation.id, messageData.eventBody.member.id).then((pureCloudMemberInfo) => {
                            switch (messageData.eventBody.member.state) {
                                case 'ALERTING':
                                    //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `[${pureCloudMemberInfo.displayName} (${pureCloudMemberInfo.role}): Alerting.]`);
                                    break;
                                case 'CONNECTED':
                                    switch (pureCloudMemberInfo.role) {
                                        case 'AGENT':
                                            // Update agent user id
                                            updatePureCloudConversation(currentConversation.smooch.conversationId, currentConversation.purecloud.conversationId, undefined, messageData.eventBody.member.id);
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Hello, my name is ${pureCloudMemberInfo.displayName}. How can I help you?`);
                                            break;
                                        case 'CUSTOMER':
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Welcome to PMI!`);
                                            break;
                                        case 'ACD':
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Please wait for an available agent...`);
                                            break;
                                        case 'WORKFLOW':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Please wait while we process your request...`);
                                            break;
                                        default:
                                            console.error(`Unknown role: ${pureCloudMemberInfo.role}`);
                                            break;
                                    }
                                    break;
                                case 'DISCONNECTED':
                                    switch (pureCloudMemberInfo.role) {
                                        case 'AGENT':
                                            // Update agent user id
                                            clearPureCloudConversation(currentConversation.smooch.conversationId);
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `${pureCloudMemberInfo.displayName} has disconnected`);
                                            break;
                                        case 'CUSTOMER':
                                            if (currentConversation.purecloud.conversationId) {
                                                postPureCloudMessage(currentConversation.purecloud.conversationId, currentConversation.purecloud.externalUserId, `${currentConversation.smooch.firstName} ${currentConversation.smooch.lastName} has disconnected`, 'notice');
                                            }
                                            break;
                                        case 'ACD':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Please wait for an available agent...`);
                                            break;
                                        case 'WORKFLOW':
                                            //postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Please wait while we process your request...`);
                                            break;
                                        default:
                                            console.error(`Unknown role: ${pureCloudMemberInfo.role}`);
                                            break;
                                    }
                                default:
                                    console.error(`Unknown state: ${messageData.eventBody.member.state}`);
                                    break;
                            }
                        }).catch((error) => {
                            console.error(error);
                        });
                        break;
                    default:
                        break;
                }
            });

            webSocket.on('close', () => {
                console.log('WebSocket closed');
            })

        } else {
            console.error(body);
            console.error(response.statusCode);
        }
    });
};

// Posts a message to an existing PureCloud chat conversation
function postPureCloudMessage(conversationId, memberId, message, messageType) {
    console.log(`====> TO PURECLOUD: ${message} -> PureCloud Conversation Id: ${conversationId}, Member Id: ${memberId}`);

    console.log(`Posting PureCloud Message to conversation ${conversationId} and member ${memberId} with jwt: ${jwtToken}`);
    let body = {
        "body": message,
        "bodyType": messageType
    };

    let options = {
        url: `https://api.${PURECLOUD_ENVIRONMENT}/api/v2/webchat/guest/conversations/${conversationId}/members/${memberId}/messages`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(body)
    };

    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var info = JSON.parse(body);
            console.log('POST /messages response:', info);
        } else {
            console.error(body);
            console.error(response.statusCode);
        }
    });
}

//#endregion

// Start server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
