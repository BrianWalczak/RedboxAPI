const { decrypt, encMethod } = require('./encryption.js');
const { readUsers, saveUsers, updateUser, createCPN, getUserByProfileNumber } = require('./utils.js');
const bcrypt = require('bcryptjs');

/*
    Earn 150 points per night when you rent a disc
    Earn 50+ points for every $1.00 spent when you buy a used disc (based on tier):
    - 50 points for Member
    - 50 points for Star
    - 75 points for Superstar
    - 100 points for Legend
    2,000 points = 1 free 1-night disc rental

    Source: https://www.redbox.com/perks
*/
const TIER_MULTIPLIER = { // points per $1.00 spent based on tier (for used disc purchases)
    "Member": process.env.EARNING_MEMBER || 50,
    "Star": process.env.EARNING_STAR || 50,
    "Superstar": process.env.SUPERSTAR || 75,
    "Legend": process.env.EARNING_LEGEND || 100
};
const POINTS_PER_NIGHT = {
    "Accrual": process.env.RENTAL_POINTS_PER_NIGHT || 150, // 150 points per night
    "Redemption": process.env.RENTAL_REDEMPTION_GOAL || 2000 // 2,000 points per night
}

function estimateAccrual(user, data, excludeRentals = false) {
    let items = [];
    data.Groups.forEach(group => {
        const groupType = group.GroupType;
        if (groupType === 1 && excludeRentals === true) return; // don't include rentals if not wanted

        group.Items.forEach(item => {
            let points = 0;
            
            if (groupType === 1) { // Rentals
                const rentalDays = item.Pricing.InitialDays || 1;
                points = POINTS_PER_NIGHT['Accrual'] * rentalDays;
            }
            
            if (groupType === 2) { // Used disc purchases
                const tierPoints = TIER_MULTIPLIER[user.loyalty.currentTier] || 50;
                points = Math.round(item.Pricing.Purchase * tierPoints);
            }

            items.push({
                productId: item.ProductId,
                points: points
            });
        });
    });

    return items;
}

function estimateRedemption(data) {
    let items = [];
    data.Groups.forEach(group => {
        const groupType = group.GroupType;

        group.Items.forEach(item => {
            let points = 0;
            
            if (groupType === 1) { // Rentals (only worked for rentals)
                const rentalDays = item.Pricing.InitialDays || 1;
                points = POINTS_PER_NIGHT['Redemption'] * rentalDays;
            }

            items.push({
                productId: item.ProductId,
                points: points
            });
        });
    });

    return items;
}

function calculateTier(purchases) {
    if (purchases < 10) {
        return "Member"; // < 10 purchases
    } else if (purchases >= 10 && purchases <= 19) {
        return "Star"; // 10-19 rentals
    } else if (purchases >= 20 && purchases <= 49) {
        return "Superstar"; // 20-49 rentals
    } else if (purchases >= 50) {
        return "Legend"; // 50+ rentals
    }
}

async function initialRewards(user, data) {
    const accrual = estimateAccrual(user, data, true); // exclude rentals since those are credited later, they could only receive points immediately for purchased discs, returned ones will receive points later
    let earningPoints = 0;
    let losingPoints = 0;

    accrual.forEach(rental => {
        earningPoints += rental.points; // add points for each permanent disc purchase
    });

    data.Discounts.forEach(discount => {
        if(discount.RedemptionPoints && discount.RedemptionPoints > 0) {
            losingPoints += discount.RedemptionPoints; // redeemed points were lost immediately as well
        }
    });

    user.loyalty.pointBalance += earningPoints; // update points with added for purchases
    user.loyalty.pointBalance -= losingPoints; // remove points that were redeemed
    user.loyalty.tierCounter += accrual.length; // count the amount of purchases they have
    user.loyalty.currentTier = calculateTier(user.loyalty.tierCounter); // calculate the users tier based on their amount of purchases
    await updateUser(user);
}

async function updateRewards(barcode, transaction) {
    const item = transaction.items.Rental.find(item => item.returnedDate && item.Barcode == barcode.toString()); // find the barcode in the transaction
    if(!item) return;

    const user = await getUserByProfileNumber(transaction?.customerProfileNumber);
    if (user) { // if there's a rewards account
        const rentalDate = new Date(transaction.transactionDate); // time they rented the disc
        const returnDate = new Date(item.returnedDate); // time they returned the disc

        // If the rental was returned on the same day, count as 1 night
        let NIGHTS_COUNT = Math.max(1, Math.ceil((returnDate - rentalDate) / (1000 * 60 * 60 * 24)));

        user.loyalty.pointBalance += POINTS_PER_NIGHT['Accrual'] * NIGHTS_COUNT; // update points with added
        user.loyalty.tierCounter += NIGHTS_COUNT; // add amount of nights
        user.loyalty.currentTier = calculateTier(user.loyalty.tierCounter); // calculate their new rewards tier

        transaction.discounts.forEach(discount => {
            if(discount.ProductId === item.ProductId && discount.RedemptionPoints && discount.RedemptionPoints > 0) {
                user.loyalty.pointBalance -= POINTS_PER_NIGHT['Accrual'] * NIGHTS_COUNT; // if a rental was redeemed for points, they wouldn't get points for it, so take them off
            }
        });

        await updateUser(user);
    }
}

async function createAccount(data) {
    const users = await readUsers();
    
    const tempPassword = Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=<>?'.charAt(Math.floor(Math.random() * 70))).join('');
    const pin = data.Pin ? decrypt(data.Pin, encMethod.local) : null;

    if(data.Email && users.find(user => user.emailAddress === data.Email)) { // if email address already in use
        return {
            success: false,
            reason: 'It looks like this email address is already associated with an account.'
        };
    }

    if(data.MobilePhoneNumber && users.find(user => user.phoneNumber === data.MobilePhoneNumber)) { // if mobile number already in use
        return {
            success: false,
            reason: 'It looks like this phone number is already associated with an account.'
        };
    }

    if(pin && (pin.length !== 4 || isNaN(Number(pin)))) { // if the PIN entered is invalid (through some XHR attack)
        return {
            success: false,
            reason: 'You entered an invalid PIN, please try again.'
        };
    }

    const newUser = {
        "cpn": await createCPN(),
        "signupDate": new Date().toISOString(),
        "firstName": null,
        "emailAddress": data.Email || null,
        "phoneNumber": data.MobilePhoneNumber || null,
        "password": await bcrypt.hash(tempPassword, 10), // hash the password w/ bcrypt
        "pin": pin ? await bcrypt.hash(pin, 10) : null, // hash the PIN w/ bcrypt
        "hashed": true, // migrate to bcrypt for hashing (safe storage of passwords)
        "loyalty": {
            "pointBalance": process.env.NEW_POINT_BALANCE || 2000, // Get a FREE 1-night disc rental for signing up.
            "currentTier": process.env.NEW_TIER_DEFAULT || "Member", // this is their tier (calculated based on purchases)
            "tierCounter": 0 // this is their purchase count
        },
        "promoCodes": []
    };

    users.push(newUser);
    result = {
        success: true,
        data: {
            ...newUser,
            tempPassword: tempPassword // include the decrypted, temporary password here for the output
        }
    };

    await saveUsers(users);
    return result;
}

module.exports = {
    estimateAccrual,
    estimateRedemption,
    initialRewards,
    updateRewards,
    createAccount
}