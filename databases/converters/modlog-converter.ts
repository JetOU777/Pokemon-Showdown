// Needed for FS
(global as any).Config = {nofswriting: false};

import {FS} from '../../lib/fs';
import Database = require('better-sqlite3');

type ModlogFormat = 'txt' | 'sqlite';

interface Log {
	timestamp: number;
	roomid: string;
	action: string;
	actionTaker?: string;
	userid?: string;
	ac?: string;
	alts?: string[];
	ip?: string;
	note?: string;
}

function parseModlog(line: string, isGlobal: boolean = false): Log {
	if (!line) return;
	const parseBrk = (line: string, brkType: ['(' | '[', ')' | ']']) => {
		const brkOpnIdx = line.indexOf(brkType[0]);
		const brkClsIdx = line.indexOf(brkType[1]);
		return line.slice(brkOpnIdx + 1, brkClsIdx);
	};
	const parseMltBrk = (line, brkType: ['(' | '[', ')' | ']']) => {
		const res = [];
		res.push(parseBrk(line, brkType));
		line = line.slice(res[0].length + 2);
		while (line[0] === ',') {
			line = line.slice(2);
			res.push(parseBrk(line, brkType));
			line = line.slice(res[res.length - 1].length + 2);
		}
		return [res, line.trim()];
	};
	const log: Log = Object.create(null);
	const timestamp = parseBrk(line, ['[', ']'])
	log.timestamp = Math.floor(new Date(timestamp).getTime() / 1000);
	line = line.slice(timestamp.length + 3);
	let roomid = parseBrk(line, ['(', ')']);
	log.roomid = isGlobal ? `global-${roomid}` : roomid;;
	line = line.slice(roomid.length + 3);
	const actClnIdx = line.indexOf(':');
	const action = line.slice(0, actClnIdx);
	log.action = action;
	line = line.slice(actClnIdx + 2);
	if (line[0] === '[') {
		const userid = parseBrk(line, ['[', ']'])
		log.userid = userid;
		line = line.slice(userid.length + 3);
		if (line.startsWith('ac:')) {
			line = line.slice(3);
			log.ac = parseBrk(line, ['[', ']']);
			line = line.slice(log.ac.length + 3);
		}
		if (line.startsWith('alts:')) {
			line = line.slice(5);
			const [alts, nLine] = parseMltBrk(line, ['[', ']']);
			log.alts = alts;
			line = nLine;
		}
		if (line[0] === '[') {
			log.ip = parseBrk(line, ['[', ']']);
			line = line.slice(log.ip.length + 3);
		}
	}
	const actTkrClnIdx = line.indexOf(':');
	const actionTaker = line.slice(3, actTkrClnIdx > -1 ? actTkrClnIdx : undefined);
	log.actionTaker = actionTaker;
	if (actTkrClnIdx > -1) {
		line = line.slice(actTkrClnIdx + 1);
		const note = line.slice(1);
		log.note = note;
	}
	return log;
}

function rawifyLog(log: Log) {
	return `[${new Date(log.timestamp * 1000).toJSON()}] (${log.roomid}) ${log.action}:${log.userid ? ' [' + log.userid + ']' : ''}${log.ac ? ' ac:[' + log.ac + ']' : ''}${log.alts ? ' alts:[' + log.alts + ']' : ''}${log.ip ? ' ip:[' + log.ip + ']' : ''}${log.actionTaker ? ' by ' + log.actionTaker : ''}${log.note ? ': ' + log.note : ''}\n`
}

const ModlogConverterSQLite = {
	async toTxt() {
		const database = new Database('databases/sqlite.db', { fileMustExist: true });
		const stmt = database.prepare('SELECT DISTINCT roomid FROM modlog;');
		const roomids = stmt.all();
		const rawLogs: {[roomid: string]: string[]} = {};
		for (const {roomid} of roomids) {
			console.log(roomid);
			const stmt = database.prepare(`SELECT * FROM modlog WHERE roomid = ? OR roomid = ? ORDER BY timestamp ASC`);
			const results = stmt.all(roomid, `global-${roomid}`);
			for (const result of results) {
				const key = roomid.split('-')[0];
				if (!rawLogs[key]) rawLogs[key] = [];
				result.actionTaker = result.action_taker;
				result.ac = result.autoconfirmed_userid;
				result.alts = result.alts?.join(',');
				if (result.roomid.startsWith('global-')) result.roomid = result.roomid.slice(7);
				rawLogs[key].push(rawifyLog(result));
			}
		}
		for (const [roomid, logs] of Object.entries(rawLogs)) {
			FS(`logs/modlog/modlog_${roomid}.txt`).write(logs.join(''));
		}
	}
}

const ModlogConverterTxt = {
	async toSQLite() {
		const files = await FS(`logs/.modlog-backup`).readdir();
		let logs: {[roomid: string]: Log[]} = {};
		// Read global modlog last to avoid inserting duplicate data to database
		if (files.includes('modlog_global.txt')) {
			files.splice(files.indexOf('modlog_global.txt'), 1);
			files.push('modlog_global.txt');
		}
		for (const file of files) {
			if (file === 'README.md') continue;
			const raw = await FS(`logs/.modlog-backup/${file}`).read();
			const roomid = file.slice(7, -4);
			logs[roomid] = raw.split('\n').map(line => {
				const log = parseModlog(line, roomid === 'global')
				if (log && roomid === 'global') {
					const loggedRoomid = log.roomid.split('-').slice(1).join('-');
					logs[loggedRoomid].forEach((val, idx) => {
						if (JSON.stringify(val) === JSON.stringify(Object.assign({}, log, {roomid: loggedRoomid}))) {
							logs[loggedRoomid].splice(idx, 1);
						}
					});
				}
				return log;
			});
		}
		const database = new Database('databases/sqlite.db', { fileMustExist: true });
		const stmt = database.prepare(`
			INSERT INTO modlog (timestamp, roomid, action, action_taker, userid, autoconfirmed_userid, alts, ip, note)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const tx = database.transaction((logs: Log[]) => {
			for (const log of logs) {
				if (!log) continue;
				stmt.run(log.timestamp, log.roomid, log.action, log.actionTaker, log.userid, log.ac, log.alts?.join(','), log.ip, log.note);
			}
		});
		Object.values(logs).map(logs => tx(logs));
	},
};

export class ModlogConverter {
	static async convert(from: ModlogFormat, to: ModlogFormat) {
		if (from === 'sqlite' && to === 'txt') {
			return ModlogConverterSQLite.toTxt();
		} else if (from === 'txt' && to === 'sqlite') {
			return ModlogConverterTxt.toSQLite();
		}
	}
}