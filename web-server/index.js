const { rateLimit } = require('express-rate-limit');
const session = require('express-session');
const express = require('express');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const GENERAL_RATE_LIMIT = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    limit: 300, // 300 requests per IP per 24 hours (this is for the entire website, so just viewing the pages counts)
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "It looks like you've reached the maximum requests. Please try again in 24 hours."
});

const LOGIN_RATE_LIMIT = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    limit: 30, // 30 logins per IP per 24 hours (we're being generous here, in case it fails sometimes)
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "It looks like you've reached the maximum login attempts. Please try again in 24 hours."
});

const SIGNUP_RATE_LIMIT = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    limit: 5, // 5 signups per IP per 24 hours (we're being generous here, in case it fails sometimes)
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "It looks like you've already created an account. Please try again in 24 hours."
});

const UPDATE_RATE_LIMIT = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    limit: 60, // 60 account updates per IP per 5 minutes
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: "It looks like you've reached the maximum updates, please try again in 5 minutes."
});

const usersFilePath = path.join(__dirname, process.env.USERS_FILE_PATH);
if(process.env.NGINX_PROXY_MANAGER.toString() === 'true') app.set('trust proxy', 'loopback'); // configured for nginx proxy manager
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(GENERAL_RATE_LIMIT);
app.use(session({ // login sessions
    secret: process.env.SESSION_TOKEN,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'strict',
        httpOnly: true
    }
}));

// Read users from users.json
async function readUsers() {
    const data = await fs.promises.readFile(usersFilePath, 'utf8');

    try {
        return JSON.parse(data);
    } catch(error) {
        return [];
    }
}

// Save users to users.json
async function saveUsers(users) {
    await fs.promises.writeFile(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
}

// Creates a user ID, checks for one that's unused
async function createCPN() {
    const users = await readUsers();
    let userCpn = null;

    while (!userCpn) {
        let newCpn = Math.random().toString().slice(2, 12); // create a 10-digit user id
        if (users.find(user => user.cpn === newCpn) == null) {
            userCpn = newCpn;
        }
    }

    return userCpn;
}

// Verify the reCAPTCHA response
async function verifyRecaptcha(recaptchaToken) {
    try {
        const { data } = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: recaptchaToken
            }
        });

        return data.success;
    } catch (error) {
        console.error("reCAPTCHA verification failed:", error);
        return false;
    }
}

// Check if an email is valid
function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

// Prevents logged-in users from accessing the login and signup pages
const rejectLoggedIn = (req, res, next) => {
    if (req.session.user) {
        return res.send('It looks like you already have an account for perks.');
    }
    next();
};

app.get('/', (req, res) => {
    res.redirect('/login'); // we don't have a home page yet..
});

app.get('/login', (req, res) => {
    if(req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.render('login', { recaptcha: process.env.RECAPTCHA_PUBLIC_KEY });
    }
});

app.get('/signup', (req, res) => {
    if(req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.render('signup', { recaptcha: process.env.RECAPTCHA_PUBLIC_KEY });
    }
});

app.get('/dashboard', async (req, res) => {
    if(!req.session.user) {
        res.redirect('/login');
    } else {
        const users = await readUsers();
        const user = users.find(user => user.cpn === req.session.user);

        res.render('dashboard', { user, recaptcha: process.env.RECAPTCHA_PUBLIC_KEY, newUser: (!user.firstName) });
    }
});

app.get('/logout', (req, res) => {
    if(req.session.user) {
        req.session.destroy();
    }

    res.redirect('/login');
});

// Delete the user's account completely
app.post('/delete', async (req, res) => {
    if(!req.session.user) {
        res.redirect('/login');
    } else {
        const users = await readUsers();
        const newUsers = users.filter(user => user.cpn !== req.session.user); // filter out the user from the users.json file (removing them)
        await saveUsers(newUsers);

        req.session.destroy();
        res.redirect('/login/?deleted=true'); // deleted param for success message
    }
});

// Login and create a session
app.post('/login', rejectLoggedIn, LOGIN_RATE_LIMIT, async (req, res) => {
    const { 'email': providedEmail, password, 'g-recaptcha-response': recaptchaToken } = req.body;
    const email = providedEmail.toLowerCase(); // lower case email

    // Check if they have all the fields
    if (!email || !password || !recaptchaToken) {
        return res.json({ error: 'It looks like your request was malformed. Please refresh the page and try again!' });
    }

    // Verify the reCAPTCHA
    if (!(await verifyRecaptcha(recaptchaToken))) {
        return res.json({ error: 'It looks like the reCAPTCHA verification failed. Please try again.' });
    }

    // Check if the user exists
    const users = await readUsers();
    const user = users.find(user => user.emailAddress === email);
    if (!user) {
        return res.json({ error: 'It looks like your email or password provided is incorrect.' });
    }

    // Check if the password is correct
    const passwordMatch = user.hashed ? (await bcrypt.compare(password, user.password)) : (user.password === password)
    if (!passwordMatch) {
        return res.json({ error: 'It looks like your email or password provided is incorrect.' });
    }

    req.session.user = user.cpn;
    res.json({ success: true, message: 'You have been successfully logged into your Redbox account!' });
});

// Signup as a new user for program
app.post('/signup', SIGNUP_RATE_LIMIT, rejectLoggedIn, async (req, res) => {
    const { firstName, 'email': providedEmail, password, 'g-recaptcha-response': recaptchaToken } = req.body;
    const email = providedEmail.toLowerCase(); // lower case email

    // Check if they have all the fields
    if (!firstName || !email || !password || !recaptchaToken) {
        return res.json({ error: 'It looks like your request was malformed. Please refresh the page and try again!' });
    }

    // Check if email is valid
    if(!isValidEmail(email)) {
        return res.json({ error: 'It looks like you entered an invalid email! Please try again.' });
    }

    // Verify the reCAPTCHA
    if (!(await verifyRecaptcha(recaptchaToken))) {
        return res.json({ error: 'It looks like the reCAPTCHA verification failed. Please try again.' });
    }

    // Check if the email is taken (already has an account)
    const users = await readUsers();
    if (users.find(user => user.emailAddress === email)) {
        return res.json({ error: "It looks like there's already an account under this email." });
    }

    const newUser = {
        "cpn": await createCPN(),
        "signupDate": new Date().toISOString(),
        "firstName": firstName,
        "emailAddress": email,
        "phoneNumber": null,
        "password": await bcrypt.hash(password, 10), // hash the password w/ bcrypt
        "pin": null,
        "hashed": true, // migrate to bcrypt for hashing (safe storage of passwords)
        "loyalty": {
            "pointBalance": 2000, // Get a FREE 1-night disc rental for signing up.
            "currentTier": "Member", // this is their tier (calculated based on purchases)
            "tierCounter": 0 // this is their purchase count
        },
        "promoCodes": []
    };
    users.push(newUser);

    await saveUsers(users);
    req.session.user = newUser.cpn;
    res.json({ success: true, message: 'Congratulations! Your Perks account has been successfully created.' });
});

// If a user signs up at kiosk, we don't know their name! This fixes that problem.
app.post("/migrateName", UPDATE_RATE_LIMIT, async (req, res) => {
    const { firstName } = req.body;
    const users = await readUsers();

    // Check if they have all the fields
    if(!firstName) {
        return res.json({ error: 'It looks like your request was malformed. Please refresh the page and try again!' });
    }

    const user = users.find(user => user.cpn === req.session.user);
    if(!user) return res.json({ error: "It looks like you aren't signed in. Please refresh the page and try again!" });
    if(user.firstName !== null) return res.json({ error: "It looks like you've already set your name. Please contact support to update your name." });

    user.firstName = firstName;
    await saveUsers(users);

    res.json({ success: true });
});

app.post("/update", UPDATE_RATE_LIMIT, async (req, res) => {
    if(!req.session.user) {
        res.redirect('/login');
    } else {
        const { 'email': providedEmail, password, 'g-recaptcha-response': recaptchaToken } = req.body;
        const email = providedEmail.toLowerCase(); // lower case email

        // Verify the reCAPTCHA
        if (!(await verifyRecaptcha(recaptchaToken))) {
            return res.json({ error: 'It looks like the reCAPTCHA verification failed. Please try again.' });
        }

        const users = await readUsers();
        const user = users.find(user => user.cpn === req.session.user);
        const passwordMatch = user.hashed ? (await bcrypt.compare(password, (user.password || ''))) : ((user.password || '') === password); // check if password changed at all

        if(email.length !== 0 && !(email === user.emailAddress)) {
            if(!isValidEmail(email)) return res.json({ error: 'Please enter a valid email address.' });

            if(users.find(user => user.emailAddress === email)) {
                return res.json({ error: 'This email already has an account.' });
            } else {
                user.emailAddress = email;

                await saveUsers(users);
            }
        }

        if(password.length !== 0 && !passwordMatch) {
            if(password.length < 6) {
                return res.json({ error: 'Password must be at least 6 characters long.' });
            } else if(password.length > 30) {
                return res.json({ error: 'Password must be less than 30 characters long.' });
            } else {
                user.password = user.hashed ? await bcrypt.hash(password, 10) : password; // update the password w/ bcrypt (or plain-text if hashing disabled)

                await saveUsers(users);
            }
        }

        res.json({ success: true });
    }
});

app.post("/kiosk", UPDATE_RATE_LIMIT, async (req, res) => {
    if(!req.session.user) {
        res.redirect('/login');
    } else {
        const { phoneNumber, pin } = req.body;

        const users = await readUsers();
        const user = users.find(user => user.cpn === req.session.user);
        const pinMatch = user.hashed ? (await bcrypt.compare(pin, (user.pin || ''))) : ((user.pin || '') === pin); // check if PIN changed at all
        const numberMatch = user.phoneNumber === phoneNumber; // check if number changed at all

        if(phoneNumber.length === 10 && !isNaN(Number(phoneNumber)) && !numberMatch) {
            if(users.find(user => user.phoneNumber === phoneNumber)) {
                return res.json({ error: 'This phone number is already linked to another account.' });
            } else {
                user.phoneNumber = phoneNumber;

                await saveUsers(users);
            }
        }

        if(pin.length === 4 && !isNaN(Number(pin)) && !pinMatch) {
            user.pin = user.hashed ? await bcrypt.hash(pin, 10) : pin; // update the PIN w/ bcrypt (or plain-text if hashing disabled)

            await saveUsers(users);
        }

        res.json({ success: true });
    }
});

app.use((req, res, next) => {
    res.status(404).redirect('/');
});

app.listen(process.env.SERVER_PORT, () => {
    console.log(`The Redbox Perks website is sucessfully live at port ${process.env.SERVER_PORT}! 🎉`);
});