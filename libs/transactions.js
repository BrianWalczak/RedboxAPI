const path = require('path');
const fs = require('fs');

require('dotenv').config();
const dbPath = process.env.DATABASE_PATH || 'database';
const database = path.isAbsolute(dbPath) ? dbPath : path.join(__dirname, '../', dbPath);

async function createTransNumber() {
    const transactions = JSON.parse(await fs.promises.readFile(path.join(database, 'transactions.json'), "utf8"));
    let orderId = null;

    while (!orderId) {
        let newId = Math.random().toString().slice(2, 12); // create a 10-digit order number
        if (!transactions[newId]) {
            orderId = newId;
        }
    }

    return orderId;
}

async function logTransaction(orderId, trans) {
    let data = JSON.parse(await fs.promises.readFile(path.join(database, 'transactions.json'), "utf8"));
    let items = {
        Rental: [],
        Purchased: []
    };

    if (trans?.ShoppingCart?.Groups) {
        trans.ShoppingCart.Groups.forEach(group => {
            if(!group.Items) return;

            if(group.GroupType === 1) { // Rentals
                items.Rental.push(...group.Items);
            }

            if(group.GroupType === 2) { // Purchases
                items.Purchased.push(...group.Items);
            }
        });
    }

    data[orderId] = {
        email: trans?.Email,
        kioskId: trans?.KioskId,
        transactionDate: trans?.TransactionDate || new Date().toISOString(),
        customerProfileNumber: trans?.CustomerProfileNumber,
        items: items,
        discounts: trans?.ShoppingCart?.Discounts || [],
        cardInformation: trans?.CreditCard || {}
    };

    await fs.promises.writeFile(path.join(database, 'transactions.json'), JSON.stringify(data, null, 2), "utf8");
    return data;
}

async function returnedDisc(kioskId, barcode, date) {
    const data = JSON.parse(await fs.promises.readFile(path.join(database, 'transactions.json'), "utf8"));
    if(!barcode || !date) return [];

    // Find all transactions containing the disc barcode and hasn't been returned yet (at the same kiosk)
    const transactions = Object.values(data).filter(transaction =>
        transaction.items.Rental.some(item => item.Barcode === barcode.toString() && !item.returnedDate && transaction.kioskId === kioskId)
    );

    // If no transactions are found, log and exit
    if (transactions.length === 0) {
        console.log('The barcode ' + barcode + ' was returned, but there are no transactions associated for it.')
        return null;
    }

    // Get the most recent transaction
    const latestTransaction = transactions.reduce((latest, current) => 
        new Date(current.transactionDate) > new Date(latest.transactionDate) ? current : latest
    );

    transactions.forEach(transaction => {
        transaction.items.Rental.forEach(item => {
            if (transaction === latestTransaction) { // if it's the latest transaction
                item.returnedDate = date; // use the return date
            } else { // if it's some old, uncaught transaction
                item.returnedDate = latestTransaction.transactionDate; // Use the newest transaction as the return date for the old transactions (we're doing this cause if the server is down then it won't mark transactions as complete, so this is just a safety mechanism if there's other old transactions with the same DVD)
            }
        });
    });

    await fs.promises.writeFile(path.join(database, 'transactions.json'), JSON.stringify(data, null, 2), 'utf8');
    return transactions; // will be used for rewards later
}


module.exports = {
    createTransNumber,
    logTransaction,
    returnedDisc
};