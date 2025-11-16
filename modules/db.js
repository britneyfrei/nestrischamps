import pg from 'pg';

let pool;

const isPublicServer = /^(1|on|true)$/i.test(process.env.IS_PUBLIC_SERVER);

console.log(`DB initialization`, {
	IS_PUBLIC_SERVER: isPublicServer,
});

console.log(`PORT: ${process.env.PORT}`);

pool = new pg.Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false, // isPublicServer,
	},
});

// the pool will emit an error on behalf of any idle clients
// it contains if a backend error or network partition happens
pool.on('error', err => {
	console.error('DB: Unexpected error on idle client', err);
});

export default pool;
