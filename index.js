const express = require("express");
const path = require('path');
const fs = require("fs");
const bcrypt = require('bcryptjs');
const { decrypt, encMethod } = require('./libs/encryption.js');
const { sendReceipt, sendSignup } = require('./libs/mailing.js');
const { createTransNumber, logTransaction, returnedDisc } = require('./libs/transactions.js');
const { estimateAccrual, estimateRedemption, initialRewards, updateRewards, createAccount } = require('./libs/loyalty.js');
const { getUserByEmail, getUserByPhoneNumber, getUserByProfileNumber } = require('./libs/utils.js')
const app = express();

/* Body Parsing */
app.use(express.json()); // Handle JSON request bodies
app.use(express.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' })); // Handle form bodies
app.use(express.text({ type: 'text/*' })); // Handle text bodies

async function getLocalCredentials(username, type) {
    const data = await fs.promises.readFile("database/credentials.json", "utf8");
    const cred = JSON.parse(data);

    return cred[type].find(user => user.username === username);
}


// -- Express.js Server -- //

// Redbox Desktop + Field Maintenance login endpoint
app.post("/api/kiosk/authenticate", async (req, res) => {
    const credentials = await getLocalCredentials(req.body.Username, req.body.UseNtAuthentication ? 'desktop' : 'field');

    if(credentials && decrypt(req.body.Password, encMethod.local) === credentials.password) {
        console.log("A new login has been authorized for " + (req.body.UseNtAuthentication ? 'Redbox Desktop' : 'Field Maintenance') + ` (user ${req.body.Username}).`);
    
        res.json({ success: true });
    } else {
        console.log("A new login has been rejected for " + (req.body.UseNtAuthentication ? 'Redbox Desktop' : 'Field Maintenance') + '.');
        console.log(`Username: ${req.body.Username} (${credentials ? 'found' : 'not found'})`);
        console.log("Password:", decrypt(req.body.Password, encMethod.local));
    
        res.json({ success: false });
    }
});


// Login to Redbox kiosk as a user for rewards
app.post("/api/customerprofile/login", async (req, res) => {
    const isEmailAuth = req.body.EmailAddress && req.body.Password; // user authenticated with email and password
    const isPinAuth = req.body.PhoneNumber && req.body.Pin; // user authenticated with phone number and PIN
    let user;

    if (isEmailAuth || isPinAuth) {
        const identifier = isEmailAuth ? req.body.EmailAddress : req.body.PhoneNumber; // user identifier
        const credential = isEmailAuth ? req.body.Password : req.body.Pin; // user authentication
    
        const getUser = isEmailAuth ? await getUserByEmail(identifier) : await getUserByPhoneNumber(identifier);
        let authentication = req.body.IsEncrypted ? decrypt(credential, encMethod.customer) : credential;
        if(!getUser) return res.json({
            success: false,
            errors: [
                {
                    code: "400",
                    message: "It looks like you don't have an account yet!"
                }
            ]
        });

        if(getUser?.disabled === true) return res.json({
            success: false,
            errors: [
                {
                    code: "403",
                    message: "Your account has been flagged and terminated! Please contact customer support."
                }
            ]
        });

        if (getUser.hashed) { // if authentication method is hashed w/ bcrypt
            if (await bcrypt.compare(authentication, (getUser?.[isEmailAuth ? 'password' : 'pin'] || ''))) {
                user = getUser;
            }
        } else { // if the authentication method is plain-text storage
            if ((getUser?.[isEmailAuth ? 'password' : 'pin'] || '') === authentication) {
                user = getUser;
            }
        }
    }    

    let response;
    if(!user) {
        response = {
            "success": false,
            "errors": [
              {
                "code": "400",
                "message": "It looks like the login information provided is incorrect!"
              }
            ]
        };
    } else {
        response = {
            "response": {
              "customer": {
                "cpn": user.cpn,
                "firstName": user?.firstName || "Customer",
                "promptForPerks": false,
                "promptForEarlyId": false
              },
              "loyalty": {
                "loyaltySystemOnline": true,
                "isEnrolled": true,
                "pointBalance": user.loyalty.pointBalance,
                "currentTier": user.loyalty.currentTier,
                "currentTierCounter": user.loyalty.tierCounter
              },
              "promoCodes": user.promoCodes,
              "optIns": []
            },
            "success": true,
            "statusCode": 200
        };

        if(user?.emailAddress) response.response.customer['loginEmail'] = user.emailAddress; // email address (if exists)
        if(user?.phoneNumber) response.response.customer['mobilePhoneNumber'] = user.phoneNumber; // phone number (if exists)
    }

    res.json(response);
});

// Check if user has a rewards account (if not, display sign up popup)
app.post("/api/marketing/emailconfirmation", async (req, res) => {
    const user = await getUserByEmail(req.body.Email);
    let response = {
        "messageId": req.body.MessageId,
        "promptForEarlyId": true, // prompt guest to sign-up at checkout after entering their email (checks if they have an account first)
        "promptForPerks": true, // set to true when guest doesn't have an account. if set to false, it will say "you already have an account" and will prompt them to setup their kiosk login on the website
        "emailVerified": true, // checks if the email address is valid (to prevent spam?)
        "success": true,
        "statusCode": 200
    };

    if(user) {
        // the user already has an account, prompt to visit the website in order to setup their kiosk login
        response.promptForPerks = false;
        response.promptForEarlyId = false;

        // add the user information if exists
        if(user?.cpn) response['customerProfileNumber'] = user.cpn;
        if(user?.phoneNumber) response['mobilePhoneNumber'] = user.phoneNumber;
    }
    
    res.json(response);
});

// Update a users Redbox account with a PIN/phone number (ran when they haven't set their kiosk login yet)
app.post("/api/loyalty/updateaccount", async (req, res) => {
    const update = await createAccount(req.body);

    if(!update.success) return res.status(500).json({
        "messageId": req.body.MessageId,
        "kioskId": req.body.KioskId,
        "error": update.reason
    });

    await sendSignup(update.data.emailAddress, update.data.tempPassword, req.body.KioskId); // send email of temporary password

    res.json({
        "messageId": req.body.MessageId,
        "kioskId": req.body.KioskId,
        "customerProfileNumber": update.data.cpn,
        "mobilePhoneNumber": update.data?.phoneNumber || '',
        "tempPassword": update.data.tempPassword // this is a temporary password for their Redbox account
    });
});

// Estimates the amount of points a user will earn for their purchase
app.post("/api/loyalty/estimateaccrual", async (req, res) => {
    const user = await getUserByProfileNumber(req.body.CustomerProfileNumber); // get user tier

    res.json({
        "items": estimateAccrual(user, req.body.ShoppingCart),
        "kioskId": req.body.KioskId,
        "success": true,
        "statusCode": 200
    });
});

// Estimates the amount of points a user will redeem for their purchase
app.post("/api/loyalty/estimateredemption", (req, res) => {
    res.json({
        "items": estimateRedemption(req.body.ShoppingCart),
        "kioskId": req.body.KioskId,
        "success": true,
        "statusCode": 200
    });
});

// This authorizes the transaction to ensure all card details are correct (runs after zip code entry)
app.post("/api/transaction/authorize", (req, res) => {
    res.json({ success: true }); // continue with processing
});

// This confirms the transaction and processes it, once the discs are dispensed (runs after email confirmation, and disc vending)
app.post("/api/transaction/reconcile", async (req, res) => {    
    const transNumber = await createTransNumber(); // create a transaction number for reference
    await logTransaction(transNumber, req.body); // process the transaction

    if(req.body?.CustomerProfileNumber) {
        const user = await getUserByProfileNumber(req.body.CustomerProfileNumber);
        await initialRewards(user, req.body?.ShoppingCart); // update user rewards if logged in
    }

    if(req.body?.Email) {
        await sendReceipt(transNumber, req.body); // send a receipt copy if email was provided
    }

    res.json({
        "customerProfileNumber": req.body?.CustomerProfileNumber || '',
        "success": true,
        "statusCode": 200
    });
});

// This occurs when a user returns their disc at a kiosk
app.post("/api/transaction/return", async (req, res) => {
    const transactions = await returnedDisc(req.body?.KioskId, req.body?.Barcode, req.body?.ReturnDate);
    if(!transactions) return res.json({ success: true });

    for (const transaction of transactions) {
        if(transaction.customerProfileNumber) {
            await updateRewards(req.body?.Barcode, transaction);
        }
    }

    res.json({ success: true });
});

async function startServer() {
    const requiredFiles = ['credentials.json', 'users.json', 'transactions.json'];

    // Check if each required file exists, if not, create it with default content
    for (const file of requiredFiles) {
        const filePath = path.join(__dirname, 'database', file);
        if (!fs.existsSync(filePath)) {
            let content = {};

            if(file === 'credentials.json') {
                content = { "desktop": [], "field": [] };
            } else if(file === 'users.json') {
                content = [];
            } else if(file === 'transactions.json') {
                content = {};
            }

            fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
        }
    }

    // Start the server once done
    app.listen(process.env.SERVER_PORT, () => {
        console.log(`The Redbox API is sucessfully live at port ${process.env.SERVER_PORT}! 🎉`);
    });
}

startServer();