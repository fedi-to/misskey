import * as kue from 'kue';

import { verifySignature } from 'http-signature';
import parseAcct from '../../../acct/parse';
import User, { IRemoteUser } from '../../../models/user';
import act from '../../../remote/activitypub/act';
import resolvePerson from '../../../remote/activitypub/resolve-person';

// ユーザーのinboxにアクティビティが届いた時の処理
export default async (job: kue.Job, done): Promise<void> => {
	const signature = job.data.signature;
	const activity = job.data.activity;

	const keyIdLower = signature.keyId.toLowerCase();
	let user;

	if (keyIdLower.startsWith('acct:')) {
		const { username, host } = parseAcct(keyIdLower.slice('acct:'.length));
		if (host === null) {
			console.warn(`request was made by local user: @${username}`);
			done();
			return;
		}

		user = await User.findOne({ usernameLower: username, hostLower: host }) as IRemoteUser;
	} else {
		user = await User.findOne({
			host: { $ne: null },
			'account.publicKey.id': signature.keyId
		}) as IRemoteUser;

		// アクティビティを送信してきたユーザーがまだMisskeyサーバーに登録されていなかったら登録する
		if (user === null) {
			user = await resolvePerson(signature.keyId);
		}
	}

	if (user === null) {
		done(new Error('failed to resolve user'));
		return;
	}

	if (!verifySignature(signature, user.account.publicKey.publicKeyPem)) {
		console.warn('signature verification failed');
		done();
		return;
	}

	// アクティビティを処理
	try {
		await act(user, activity);
		done();
	} catch (e) {
		done(e);
	}
};
