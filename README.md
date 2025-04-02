<h1 align="center">Redbox Stocker - Loyalty API for Redbox kiosks.</h1>

<p align="center">A feature-rich API designed to restore the functionality of your Redbox kiosk and reinstate the Redbox Perks loyalty system. This enables users to sign up, earn points, and enjoy free DVD rentals!<br></p>

> [!TIP]
> Big thanks to the Redbox Tinkering Community for making this project possible! You can join the Discord server by clicking [here](https://discord.gg/redboxtinkering).

## Features
- Allow users to sign up and manage their Redbox Perks accounts on your kiosk(s).
- A dashboard for users to manage their accounts, view loyalty points, and track their purchases.
- 100% self-hosted, built with Express.js for easy integration with your Redbox kiosk.

## Installation
To get started with hosting your Redbox API instance, make sure you have Node.js and npm installed. Follow the steps below to set up your environment:

1. **Install Node.js** from [here](https://nodejs.org/).
2. Clone the repository and install the dependencies:
```bash
git clone https://github.com/BrianWalczak/RedboxAPI.git
cd RedboxAPI
npm install
```

## Setup - Redbox Perks

> [!TIP]
> Don't have a domain for your Redbox API or Redbox Perks dashboard? You can get a **\*\.redbox.my** for free at [www.redbox.my](https://redbox.my)!

To start, open the project directory and enter the web server:
```bash
cd web-server
npm install
vi .env
```

During this step, make a few configurations in the `.env` file as such:
```bash
USERS_FILE_PATH="../database/users.json"
USE_RECAPTCHA="false" # Use reCAPTCHA on your website (not required)
RECAPTCHA_PUBLIC_KEY="" # Replace with reCAPTCHA public key (optional, leave blank if disabled)
RECAPTCHA_SECRET_KEY="" # Replace with reCAPTCHA secret key (optional, leave blank if disabled)
SERVER_PORT="3000" # Port the Redbox Perks website will be live on
SESSION_TOKEN="A4c9JkT8vG2YyLw5gPsQz9fA1uKJm7eT6wExRzC9jX4sZbF2mT" # Used for express sessions (case-sensitive)
RATE_LIMITING="false" # Used to prevent spam requests, you may need to configure the web server manually to trust proxies if using nginx, apache, etc.
```

> ##### If you'd like to use reCAPTCHA (completely optional), you'll need to create a new project by visiting your [Google Cloud Console](https://console.cloud.google.com/). Then, visit the **APIs & Services** page and enable the [reCAPTCHA Enterprise API](https://console.cloud.google.com/apis/library/recaptchaenterprise.googleapis.com) (you may need to search for it). After enabling the API for your Google Cloud project, access the reCAPTCHA dashboard [here](https://www.google.com/u/1/recaptcha/admin/create) and follow the steps to add your domain (the one you'll use for the dashboard) and get your reCAPTCHA keys.

If you're okay with the default configuration, you can close the file. Once you've configured your web server, you can start it by running the `index.js` file (while still in the `web-server/` project folder).

## Setup - Redbox API

The Redbox API layer is essential for your Redbox to function properly. However, before getting started, there are a few things to take care of.

Begin by opening the File Explorer on your Redbox kiosk and clearing the folder at `C:\Program Data\Redbox\KioskClient\HttpQueue` to empty the queue of old HTTP requests (preventing any old transactions from being processed).

Make sure Standalone mode on your Redbox kiosk is **disabled**. You can find this registry key at `HKEY_LOCAL_MACHINE:\SOFTWARE\Redbox\REDS\KioskEngine\Store` (learn more in the Discord).

Next, you'll need to configure a few environment variables (`.env`).
```bash
BASE_DOMAIN="example.com" # Replace this with your hosted web-server domain (optional, used for signup emails)
SERVER_PORT="2000" # Port the Redbox API will be live on

# These details are required to send and receive Redbox receipts, and signup information.
SMTP_HOSTNAME="mail.example.com"
SMTP_PORT=465

SMTP_USERNAME="email@example.com"
SMTP_PASSWORD="password"

# Points per $1.00 spent based on tier (for used disc purchases)
EARNING_MEMBER=50
EARNING_STAR=50
EARNING_SUPERSTAR=75
EARNING_LEGEND=100

# Amount of points earned per night
RENTAL_POINTS_PER_NIGHT=150

# Redemption amount needed for 1 free night rental
RENTAL_REDEMPTION_GOAL=2000

# Points for new members
NEW_POINT_BALANCE=2000

# Default Tier User is signed up for.
# Accepted Options: Member, Star, Superstar, Legend
NEW_TIER_DEFAULT="Member"
```

Once these steps are complete and your API server is configured, start it by running the `index.js` file in the root project folder.

## Parallel Processing (recommended, read this!)
If you're planning on utilizing both the API and the Redbox Perks dashboard, you can run them both simultaneously with `concurrently` using the following command (in the root project directory):
```bash
npm install concurrently # install concurrently (if not already installed)
npx concurrently "node ." "cd web-server && node ."
```

This will start both processes, and you'll be able to see the outputs of both in the same terminal.

## Usage
To apply these changes to your Redbox kiosk (and update the API to your custom server), you’ll need to configure the kiosk.
1. In the File Explorer, navigate to the file `C:\ProgramData\Redbox\UpdateClient\IoT\iotcertificatedata.json` and delete it.
2. Open the file `C:\ProgramData\Redbox\configuration\configuration.json` in a text editor, and update **every** URL present to point to your Redbox API server (either a custom domain or your router's IP address if you're using port forwarding).

Finally, restart your Redbox kiosk to apply the changes. Your kiosk will now be connected to your custom API!

## Files
Within this project, you'll find the following files in the `database/` folder:
- **credentials.json**: Use the credentials in this file to log in to Redbox Desktop or Field Maintenance on your kiosk. You can update these credentials at any time!
- **transactions.json**: This file will contain **all** transactions made on Redbox kiosks connected to your API, including rented/purchased discs, loyalty information, card details, etc.
- **users.json**: This file stores user accounts for the Redbox Perks loyalty system. By default, user PIN/passwords are hashed and salted (thanks to [**bcrypt.js**](https://github.com/dcodeIO/bcrypt.js)) for extra security.

## Credits
Once again, a big thank you to the Redbox Tinkering Community and its members [here](https://discord.gg/redboxtinkering). Special thanks to [Puyodead1](https://github.com/Puyodead1) for providing the Redbox stores database!

## Contributions
If you'd like to contribute to this project, please create a pull request [here](https://github.com/BrianWalczak/RedboxAPI/pulls). You can submit your feedback, or any bugs that you find, on the <a href='https://github.com/BrianWalczak/RedboxAPI/issues'>issues page</a>. Contributions are highly appreciated and will help me keep this project up-to-date!

If you'd like to support this project and its development, you can join the Discord server [here](https://discord.gg/redboxtinkering) :)

<br>
  <p align="center">Made with ♡ by <a href="https://www.brianwalczak.com">Briann</a></p>
