import crypto from 'crypto'
import { Database } from 'sqlite-async'

export async function connect() {
    return await Database.open('gptgate.db')
}

function hashUserId(input) {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
}

export async function getInvitationRecordByCode(db, code) {
    const invitations = await db.all(`SELECT id, name FROM invitation where id = ?`, [code])
    if (invitations && invitations.length == 1) {
        return invitations[0]
    } else {
        console.log("Problem with invitation code, found: " + invitations.length)
        return null
    }
}

export async function createInvitation(db, name) {
    const code = generateInvitationCode(7)
    const insertQuery = 'INSERT INTO invitation (id, name) VALUES (?, ?)';
    await db.run(insertQuery, [code, name])
    return code
}

export async function getUser(db, userId) {
    const id = await hashUserId(userId)
    const rows = await db.all(`SELECT id, name, credits, role FROM user where id = '${id}'`)
    if (!rows) {
        return false
    }
    if (rows.length == 1) {
        return rows[0]
    }
    return false
}

function generateInvitationCode(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        code += charset.charAt(randomIndex);
    }
    return code;
}

export async function newUserFromInvitation(db, invitation, userId) {
    const hashedUserId = await hashUserId(userId)
    await db.transaction(async (db) => {
        const insertQuery = 'INSERT INTO user (id, name, credits, role) VALUES (?, ?, ?, ?)';
        await db.run(insertQuery, [hashedUserId, invitation.name, 10000, 'user'])
        console.log(`A new user with name ${invitation.name} has been added.`)
        await db.run("DELETE from invitation where id = ?", [invitation.id])
    })
}

export async function getCredits(db, userId) {
    const hashedUserId = hashUserId(userId)
    const row = await db.get("SELECT id, credits FROM user where id = ?", [hashedUserId])
    if (!row) {
        return null
    }
    if (row) {
        return row.credits
    }
}

export async function setCredits(db, userId, newCredits) {
    const hashedUserId = hashUserId(userId)
    await db.run('UPDATE user SET credits = ? WHERE id = ?', [newCredits, hashedUserId])
    return newCredits
}

