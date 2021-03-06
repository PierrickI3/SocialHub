# Social Hub

This service acts as a bridge between a Smooch webhook and the PureCloud Guest Chat API to allow social media messages to be sent to a PureCloud agent and allow 2-way communications.

>Code is provided as-is. Do not contact Genesys Customer Care if you have issues. Use the `Issues` tab instead and create an issue.

Tested with:
  * Facebook Messenger
  * Telegram
  * WhatsApp

Not tested with:
  * WeChat (requires an organization/business)
  * Twitter (integration can only be created using the Smooch API)
  * Line

## Requirements

* [Node.js](https://node.js)
* [nGrok](https://ngrok.com) to expose your service with a `https` url if you plan on running this service on your machine (Heroku instructions are also available in this README)
* A [Genesys PureCloud](https://www.genesys.com/platform/purecloud) organization
* A [Smooch](https://smooch.io) account (free trials are available)
* Make sure your PureCloud agents have the `person_agent` name field populated with their full name in their PureCloud profiles

## Configuration

### Smooch configuration

* Follow the steps to create a new Smooch App with at least one configured channel (e.g. Facebook Messenger) 
* Create a new key/secret pair in your app settings (menu on top of page)
* Use the environment variables in the `How to use` sections to specify you Key id and secret

>To add social media channels, click on `Integrations` in the top Smooch menu when viewing your app settings

### PureCloud configuration

* Create a new WebChat deployment with a `Third Party` type. Note its id as you will need it later on.
* Note your org id by going to Admin->Organization Settings->Show advanced details
* Make sure you have a queue to send your chat requests to. If not, well... create one.

## How to use

### Run locally

* Clone this repository: `git clone https://...`
* Run `npm i` in the new folder
* You need to update the PureCloud and Smooch configuration before starting. For this, you have two choices:
    * Using environment variables:
        * `SMOOCH_KEYID`: Your Smooch app key id
        * `SMOOCH_SECRET`: Your Smooch app secret
        * `PURECLOUD_ORGANIZATIONID`: your PureCloud organization id
        * `PURECLOUD_DEPLOYMENTID`: Your chat deployment id
        * `PURECLOUD_QUEUENAME`: Your PureCloud queue name where new chats will be queued
        * `PURECLOUD_ENVIRONMENT`: Your PureCloud environment (e.g. `mypurecloud.ie`)
    * Or you can directly hardcode those values in the code inside the `config` region of the `index.js` file
* Run `npm start` to start the service
* Run `ngrok http 8000` to expose your service
* Configure a new webhook in your Smooch app pointing to your publically-exposed service endpoint followed by `/messages` (e.g. `https://fa0291e0.ngrok.io/messages`). The webhook should be configured with the `AppUser messages` and `User typing` triggers (other triggers are not currently used. ([all triggers are documented here](https://docs.smooch.io/rest/#webhooks)))
* Send a message via the channel monitored by Smooch (e.g. Facebook Messenger). This should create chat conversations in PureCloud. Make sure you go `On Queue` to receive these chats.

### Deploy to Heroku

To deploy this service to Heroku, do the following:

* Follow the steps to install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli#download-and-install)
* Run `heroku login` to connect the Heroku CLI to your Heroku account
* Run `heroku create` from the root of this repository to create a new remote. Note the remote url that was assigned to you (e.g. [https://serene-ravine-92441.herokuapp.com/](https://serene-ravine-92441.herokuapp.com/))
* Set the required environment variables by running `heroku config:set <ENVIRONMENT VARIABLE NAME>=<ENVIRONMENT VARIABLE VALUE>` (e.g. `heroku config:set PURECLOUD_ENVIRONMENT=mypurecloud.ie`). Environment variables are listed in the `How to use` section above.
* Run `git remote -v` to make sure that the remote was added to your list of git remotes
* Run `git push heroku master` to push your code to the Heroku remote
* Create a new webhook integration in your Smoosh app with the Heroku followed by `/messages` (e.g. https://serene-ravine-92441.herokuapp.com/messages). Select the `AppUser messages` and `User typing` triggers ([all triggers are documented here](https://docs.smooch.io/rest/#webhooks)) and click on `Create webhook`.
* This service contains code (search for `startKeepAlive()`) to ping the app every 25 minutes by default and stop after 17 hours. Make sure you set the `HEROKU_APPNAME` environment variable to your app name (e.g. serene-raving-92441) by using `heroku config:set HEROKU_APPNAME=<YOUR APP NAME>` (e.g. `heroku config:set HEROKU_APPNAME=serene-raving-92441`)

#### Heroku CLI useful commands

* To view logs, run `heroku logs -t`
* To stop your dyno, run `heroku stop <APP NAME>` (e.g. `heroku stop serene-ravine-92441`)

### Developer

* Main entry point is `index.js`. Code has plenty of comments.
* Set the environment variables on your local machine (see `How to use` section)
* You can run `npm run start_dev` to start the service. Service will restart when file contents change

## Current Limitations

* Only the first message from the external user (e.g. Facebook messenger user) is passed to the PureCloud chat before it is connected to an agent. More code needs to be added to handle multiple messages before the chat is connected to an agent.
* Conversation maps (maps relationships between Smooch and PureCloud) are not persistent. If this service is restarted, messages will no longer be passed between Smooch and PureCloud for existing conversations.
* If this service is restarted, all current conversation maps are gone and therefore the existing conversations will be unlinked between Smooch and PureCloud.

## To do

* Heroku keepAlive - Can't connect to serene-ravine-92400.herokuapp.com from within heroku?
* How to easily support providers other than Smooch? Probably need to redesign conversationsMap array.

## Sample messages

Incoming message from Smooch ([message schema](https://docs.smooch.io/rest/#message-schema), [source schema](https://docs.smooch.io/rest/#sourcedestination-schema), [appUser schema](https://docs.smooch.io/rest/#schema)):

```json
{
    "trigger": "message:appUser",
    "app": {
        "_id": "5dc2b175d08253001025fba5"
    },
    "version": "v1.1",
    "messages": [
        {
            "type": "text",
            "text": "hello",
            "role": "appUser",
            "received": 1573420434.483,
            "name": "Pierrick Lozach",
            "authorId": "e19ddc5b766a5704af46ad4f",
            "_id": "5dc87d92ec629d000fb0ff42",
            "source": {
                "originalMessageId": "m_IGCOEDYUcNciafwivOSQpKnmoKWtlRy-E6rctV9kvH_p-xaKaU8_JNgcoR1nEnaUxzNFdZ_YpeUifXZaonj2Uw",
                "originalMessageTimestamp": 1573420433.996,
                "type": "messenger",
                "integrationId": "5dc2b1b3d08253001025fef9"
            }
        }
    ],
    "appUser": {
        "_id": "e19ddc5b766a5704af46ad4f",
        "conversationStarted": true,
        "surname": "Lozach",
        "givenName": "Pierrick",
        "signedUpAt": "2019-11-06T11:46:27.516Z",
        "properties": {}
    },
    "conversation": {
        "_id": "a54ce036bf1b5b13683302ae"
    }
}
```

## Credits

* Genesys
    * @PierrickI3 (that's me)
    * @szlaskidaniel (thanks for the help with the Guest Chat API late in a hotel room in Germany)