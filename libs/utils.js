const path = require('path');
const fs = require('fs');

require('dotenv').config();
const dbPath = process.env.DATABASE_PATH || 'database';
const database = path.isAbsolute(dbPath) ? dbPath : path.join(__dirname, '../', dbPath);

// -- Users Database -- //

// Read users from users.json
async function readUsers() {
    const data = await fs.promises.readFile(path.join(database, 'users.json'), 'utf8');

    try {
        return JSON.parse(data);
    } catch(error) {
        return [];
    }
}

// Save users to users.json
async function saveUsers(users) {
    await fs.promises.writeFile(path.join(database, 'users.json'), JSON.stringify(users, null, 2), 'utf8');
}

// Update a specific user in the database (based on their profile number)
async function updateUser(user) {
    const users = await readUsers();
    const userIndex = users.findIndex(u => u.cpn === user.cpn);

    if (userIndex === -1) {
        return null;
    }

    users[userIndex] = user;
    await saveUsers(users);
    
    return user;
}

// Search for a user by its email
async function getUserByEmail(emailAddress) {
    const users = await readUsers();
    return users.find(user => user.emailAddress === emailAddress);
}

// Search for a user by its phone number
async function getUserByPhoneNumber(phoneNumber) {
    const users = await readUsers();
    return users.find(user => user.phoneNumber === phoneNumber);
}

// Search for a user by its profile number
async function getUserByProfileNumber(cpn) {
    const users = await readUsers();
    return users.find(user => user.cpn === cpn);
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


// -- Stores Database -- //

// Uses the Redbox database (thanks Puyo) to find the store address from ID
async function getStore(kioskId) {
    const [stores, banners] = await Promise.all([
        fs.promises.readFile(path.join(database, 'src', "stores.json")).then(JSON.parse),
        fs.promises.readFile(path.join(database, 'src', "banners.json")).then(JSON.parse)
    ]);

    const store = stores.find(s => s.Id === Number(kioskId));
    if (!store) return null;

    store.Banner = banners.find(b => b.Id === Number(store.BannerId))?.Name || 'Unknown';

    return store;
}


module.exports = {
    readUsers, saveUsers, updateUser, createCPN, getStore,
    getUserByEmail, getUserByPhoneNumber, getUserByProfileNumber
};