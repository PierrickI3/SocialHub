# Social Hub

This service acts as a bridge between a Smooch webhook and the PureCloud Guest Chat API to allow social media messages to be sent to a PureCloud agent and allow 2-way communications.

Code is provided as-is. Do not contact Genesys Customer Care if you have issues. Use the `Issues` tab instead and create an issue.

## Requirements

* [Node.js](https://node.js)
* [nGrok](https://ngrok.com) to expose your service with a `https` url
* A [PureCloud](https://genesys.com) organization
* A [Smooch](https://smooch.io) account (free trials are available)

## Smooch configuration
* Follow the steps to create a new Smooch App with at least one configured channel (e.g. Facebook Messenger) 
* Create a new key/secret pair (TODO)

## PureCloud configuration
* Create a new WebChat deployment with a `Third Party` type. Note its id as you will need it later on.
* Note your org id by going to Admin->Organization Settings->Show advanced details
* Make sure you have a queue to send your chat requests to

## How to use
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
* Configure a new webhook in your Smooch app pointing to your publically-exposed service endpoint followed by `/messages` (e.g. `https://fa0291e0.ngrok.io/messages`). The webhook should be configured with a `message:AppUser` trigger (other triggers are not currently used)
* Send a message via the channel monitored by Smooch (e.g. Facebook Messenger). This should create chat conversations in PureCloud. Make sure you go `On Queue` to receive these chats.

## Developer
* Main entry point is `index.js`. Code is commented.
* You can run `npm run start_dev` to start the service and restart when file contents change

## Heroku

To deploy this service to Heroku, do the following:

* Follow the steps to install the [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli#download-and-install)
* Run `heroku login` to connect the Heroku CLI to your Heroku account
* Run `heroku create` from the root of this repository to create a new remote. Note the remote url that was assigned to you (e.g. [https://serene-ravine-92441.herokuapp.com/](https://serene-ravine-92441.herokuapp.com/))
* Run `git remote -v` to make sure that the remote was added to your list of git remotes
* Run `git push heroku master` to push your code to the Heroku remote
* Create a new webhook integration in your Smoosh app with the Heroku followed by `/messages` (e.g. https://serene-ravine-92441.herokuapp.com/messages). Select the `AppUser messages` trigger and click on `Create webhook`.
* This service contains code (search for `startKeepAlive()`) to ping the app every 20 minutes. Make sure you set the `HEROKU_APPNAME` environment variable to your app name (e.g. serene-raving-92441)

## Credits

* Genesys
    * Pierrick Lozach
    * Daniel Szlaski