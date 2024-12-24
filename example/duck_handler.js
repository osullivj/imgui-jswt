// hduck: DuckDB handler thread implementation
// Main browser thread: running imgui
// DB thread: DuckDB wasm engine thread
// This thread
//   Submit queries to DDBW
//   Pre process query results
//   Fetch Parquet and load into DDBW

// Some worker scope vars...
let duck_db = null;
let duck_conn = null;


async function exec_duck_db_query(sql) {
    if (!duck_db) {
        console.error("duck_handler:DuckDB-Wasm not initialized");
        return;
    }
    if (!duck_conn) {
        console.log("duck_handler:reconnecting...");
        duck_conn = await duck_db.connect();
    }
    const arrow_table = await duck_conn.query(sql);
    return arrow_table;
}


// https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/self
// "The self read-only property of the WorkerGlobalScope interface returns
// a reference to the WorkerGlobalScope itself. Most of the time it is a
// specific scope like DedicatedWorkerGlobalScope, SharedWorkerGlobalScope,
// or ServiceWorkerGlobalScope."
// Which means Worker('./duck_handler.js').postMessage(e) will cause
// self.onmessage to fire.

self.onmessage = async (event) => {
    const msg = event.data;
    // msg will either be the duck_db handle, 
    // or a SQL query
    if (typeof msg !== "string") {
        let arrow_table = await exec_duck_db_query(msg);
        const cols = arrowTable.schema.fields.map((field) => field.name);
        console.log("duck_handler cols:", cols);
        const rows = arrow_table.toArray();
        console.log("duck_handler:", tableRows);
    }
    else {
        duck_db = msg; 
    }
};