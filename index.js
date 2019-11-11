/******************************************************************************

Look at the README.md file for a high-level overview of this server. 
This code is best viewed in Microsoft Visual Studio Code. 

=========

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
            externalUserId: '',     // PureCloud participant representing the Smooch side of the chat (not PureCloud agent)
            agentUserId: '',        // PureCloud agent participant,
            workflowId: '',         // PureCloud workflow id
            webSocket: <WEBSOCKET>  // Reference to webSocket variable
        }
   }
]

Events from Smooch come in via REST API (/messages)
Events from PureCloud are handled via web sockets opened when the chats are created (see createPureCloudChat() function)

*******************************************************************************/

'use strict';

//#region Imports/Requires

const express = require('express');
const bodyParser = require('body-parser');
const Smooch = require('smooch-core');
const request = require('request');
const WebSocket = require('ws');
const http = require('http'); //Only used if pinging Heroku app

//#endregion

//#region Global vars

var conversationsMap = [], jwtToken;

//#endregion

//#region Config

const PORT = process.env.PORT || 8000;

const SMOOCH_KEYID = process.env.SMOOCH_KEYID || 'app_5dc32a436472c70010691d27';
const SMOOCH_SECRET = process.env.SMOOCH_SECRET || '3ZuI4afjVc5h1a1819BJrYh1LGi1ddqh7Pb5KTEYDTbznlzjGonrmYG7UAP1OVIwlYlqMlILMHrJaZOarw_S_A';

const PURECLOUD_ORGANIZATIONID = process.env.PURECLOUD_ORGANIZATIONID || '3b03b67a-2349-4a03-8b28-c8ac5c26c49a';
const PURECLOUD_DEPLOYMENTID = process.env.PURECLOUD_DEPLOYMENTID || '7ff41a97-03c6-498a-8266-237874b39c0c';
const PURECLOUD_QUEUENAME = process.env.PURECLOUD_QUEUENAME || 'AllAgents';
const PURECLOUD_ENVIRONMENT = process.env.PURECLOUD_ENVIRONMENT || 'mypurecloud.ie';

const HEROKU_APPNAME = process.env.HEROKU_APPNAME;
const HEROKU_POLLINGINTERVAL = 25 * 60 * 1000; // In milliseconds. Here, 25 minutes

const smooch = new Smooch({
    keyId: SMOOCH_KEYID,
    secret: SMOOCH_SECRET,
    scope: 'app'
});

const app = express();
app.use(bodyParser.json());

//#endregion

//#region Heroku

var startTime = new Date().getTime();
function startKeepAlive() {
    if (!HEROKU_APPNAME) {
        console.log('Heroku app monitoring disabled');
        return;
    }

    console.log(`Enabling app monitoring for: https://${HEROKU_APPNAME}.herokuapp.com every ${HEROKU_POLLINGINTERVAL / 1000} second(s)`);
    setInterval(function () {
        if (new Date().getTime() - startTime > 61200000) { // 17 hours (Herokuy only allows free apps to run for 18 hours)
            clearInterval(interval);
            return;
        }
        var options = {
            host: `https://${HEROKU_APPNAME}.herokuapp.com`,
            path: '/ping'
        };
        console.log('PING!');
        http.get(options, function (res) {
            res.on('data', function (chunk) {
                try {
                    // optional logging... disable after it's working
                    console.log("HEROKU RESPONSE: " + chunk);
                } catch (err) {
                    console.log(err.message);
                }
            });
        }).on('error', function (err) {
            console.log("Error: " + err.message);
        });
    }, HEROKU_POLLINGINTERVAL);
}

startKeepAlive();

//#endregion

//#region Conversations Map functions

function addSmoochConversation(smoochConversationId, smoochAppId, smoochUserId, firstName, lastName) {
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

function updatePureCloudConversation(smoochConversationId, pureCloudConversationId, externalUserId, agentUserId, webSocket, workflowId) {
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
            if (workflowId) conversationsMap[index].purecloud.workflowId = workflowId;

            returnConversation = conversationsMap[index];
            console.log(`Smooch conversation ${smoochConversationId} updated: ${JSON.stringify(returnConversation, null, 4)}`);
            break;
        }
    }

    // Do not display webSocket if there's one
    let displayReturnConversation = returnConversation;
    if (displayReturnConversation.purecloud && displayReturnConversation.purecloud.webSocket) {
        delete displayReturnConversation.purecloud.webSocket;
    }
    console.log('Updated conversation:', displayReturnConversation);

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

function getConversationByPureCloudConversationId(pureCloudConversationId) {
    let conversation = conversationsMap.filter(c => c.purecloud.conversationId === pureCloudConversationId);
    if (conversation) {
        return conversation[0];
    } else {
        return undefined;
    }
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

            addSmoochConversation(smoochConversationId, smoochAppId, smoochUserId, firstName, lastName);

            // Forward message to PureCloud
            let conversation = getConversationBySmoochConversationId(smoochConversationId);
            if (conversation.purecloud && conversation.purecloud.conversationId) {
                postPureCloudMessage(conversation.purecloud.conversationId, conversation.purecloud.externalUserId, req.body.messages[0].text, 'standard');
            } else {
                console.log('Creating new PureCloud chat...');
                createPureCloudChat(req.body.appUser.givenName, req.body.appUser.surname, smoochConversationId, req.body.messages[0].text, req.body.messages[0].source.type);
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        res.end();
    }
});

function setTypingIndicator(appId, userId) {
    smooch.appUsers.conversationActivity({
        appId: appId,
        userId: userId,
        activityProps: {
            role: 'appMaker',
            type: 'typing:start'
        }
    }).then((response) => {
        setInterval(() => {
            smooch.appUsers.conversationActivity({
                appId: appId,
                userId: userId,
                activityProps: {
                    role: 'appMaker',
                    type: 'typing:stop'
                }
            });
        }, 3 * 1000); // Set for 3 seconds following recommendation: https://developer.mypurecloud.com/api/webchat/guestchat.html#_span_style__text_transform__none___typing_indicator__event__span_
    });
}

// Only used if Heroku monitoring is enabled
app.get('/ping', async (req, res) => {
    console.log('PING');
    res.end();
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

//#region PureCloud

// Gets more information about a PureCloud chat member
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

// Creates a PureCloud chat conversation
async function createPureCloudChat(firstName, lastName, smoochConversationId, initialMessage, socialNetwork) {
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
            "avatarImageUrl": "https://amaovs.xp3.biz/img/photo/sample-image.jpg",
            "customFields": {
                "customField1Label": "First Name",
                "customField1": firstName,
                "customField2Label": "Last Name",
                "customField2": lastName,
                "customField3Label": "Social Network",
                "customField3": socialNetwork
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
            updatePureCloudConversation(smoochConversationId, info.id, info.member.id, undefined, undefined, undefined, initialMessage);

            // Initiate WebSocket communication with PureCloud (only then will it queue the chat request)
            var webSocket = new WebSocket(info.eventStreamUri);
            updatePureCloudConversation(smoochConversationId, info.id, null, null, webSocket);

            webSocket.on('open', function () {
                console.log('WebSocket opened');
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
                                    console.log('member-join:', pureCloudMemberInfo);
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
                                            updatePureCloudConversation(smoochConversationId, messageData.eventBody.conversation.id, undefined, undefined, undefined, messageData.eventBody.sender.id);
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
                                if (messageData.eventBody.sender.id === currentConversation.purecloud.agentUserId || messageData.eventBody.sender.id === currentConversation.purecloud.workflowId) {
                                    // This is a message coming from the PureCloud agent or from Architect, send it to Smooch
                                    postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, messageData.eventBody.body);
                                }
                                break;
                            default:
                                console.log('Not handling bodyType:', messageData.eventBody.bodyType);
                                break;
                        }
                        break;
                    case 'typing-indicator':
                        setTypingIndicator(currentConversation.smooch.appId, currentConversation.smooch.userId);
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
                                            // Post initial message from external user
                                            postPureCloudMessage(currentConversation.purecloud.conversationId, currentConversation.purecloud.externalUserId, initialMessage, 'notice');
                                            // Inform the smooch user there is a connected agent on PureCloud
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Hello, my name is ${pureCloudMemberInfo.displayName}. How can I help you?`);
                                            break;
                                        case 'CUSTOMER':
                                            postSmoochMessage(currentConversation.smooch.appId, currentConversation.smooch.userId, `Hello and welcome!`);
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
        var info = JSON.parse(body);
        if (!error && response.statusCode == 200) {
            console.log('POST /messages response:', info);
        } else {
            if (info.status === 400 && info.code === 'chat.error.conversation.state') {
                console.log('PureCloud conversation no longer exists (or is disconnected)');
                let conversation = getConversationByPureCloudConversationId(conversationId);
                if (conversation) {
                    clearPureCloudConversation(conversation.smooch.conversationId);
                    //TODO Resend the message in a new conversation?
                }
            } else {
                console.error(body);
                console.error(response.statusCode);
            }
        }
    });
}

//#endregion

//#region Node.js Server

// Start server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

//#endregion
