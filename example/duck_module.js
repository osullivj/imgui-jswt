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

// This JS impl was in index.html: by doing it here we avoid having to pass the
// DB handle across threads. NB this module must be pulled in to index.html
// like so...
// <script type="module" src="./duck_module.js" defer></script>

// This import was "import * as duck" so we could scope the duck names.
// However, it looks like the duck shell stuff needs these names to be
// at the top level
import * as duck from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm";
import * as shell from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell@latest/+esm";
// Cannot import wasm; we have to fetch
const shell_wasm = await fetch("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell/dist/shell_bg.wasm");

const JSDELIVR_BUNDLES = duck.getJsDelivrBundles();
const bundle = await duck.selectBundle(JSDELIVR_BUNDLES);
// creates storage and an address for the DB engine worker thread
const db_worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {type: "text/javascript",}));
const db_worker = new Worker(db_worker_url);
const logger = new duck.ConsoleLogger();
duck_db = new duck.AsyncDuckDB(logger, db_worker);
// loads the web assembly module into memory and configures it
await duck_db.instantiate(bundle.mainModule, bundle.pthreadWorker);
// revoke the object url now no longer needed
URL.revokeObjectURL(db_worker_url);
console.log("duck_module.js: DuckDB instantiated ", db_worker_url);
// main.ts uses __nodom__
window.__nodom__ = {duck_module:self, duck_db:duck_db};
// let our own event handler know window.__nodom__.duck_db is available
// tried document.postMessage(), window.postMessage and self.postMessage
// non get thru to main.ts, so we have to stick with the inefficient
// polling of __nodom__ on each render...
// window.postMessage({nd_type:"DuckInstance"});


async function exec_duck_db_query(sql) {
    if (!duck_db) {
        console.error("duck_module:DuckDB-Wasm not initialized");
        return;
    }
    if (!duck_conn) {
        console.log("duck_module:reconnecting...");
        duck_conn = await duck_db.connect();
    }
    console.log("exec_duck_dq_query: " + sql);
    const arrow_table = await duck_conn.query(sql);
    return arrow_table;
}

var summary_request = function(tbl) {
    return {nd_type: "Summarize", sql: "summarize select * from " + tbl + ";", table: tbl};
};

self.onmessage = async (event) => {
    let arrow_table = null;
    const nd_db_request = event.data;
    switch (nd_db_request.nd_type) {
        case "ParquetScan":
            // NB result set from "CREATE TABLE <tbl> as select * from parquet_scan([...])"
            // is None on success
            await exec_duck_db_query(nd_db_request.sql);
            console.log("duck_module: ParquetScan done for " + nd_db_request.table);
            // request a table summary: this will be quick as parquet metadata
            // will have provided this, so no real searches...
            let summary_req = summary_request(nd_db_request.table);
            console.log("duck_module: ParquetScanSummary SQL: " + summary_req.sql);
            // NB this is the scan summary table, not the scanned table itself!
            arrow_table = await exec_duck_db_query(summary_req.sql);           
            console.log("duck_module: ParquetScanResult:", arrow_table.table);
            postMessage({nd_type:"ParquetScanResult", table:nd_db_request.table, arrow_table:arrow_table});
            break;
        case "Query":
            arrow_table = await exec_duck_db_query(nd_db_request.sql);
            const cols = arrow_table.numCols;
            console.log("duck_module cols:", arrow_table.numCols + " rows:" + arrow_table.numRows);
            // postMessage({rtype:"query_result", schema:cols, row_count:arrow_table.numRows, query:nd_db_request.payload});
            postMessage({nd_type:"QueryResult", arrow_table:arrow_table});
            break;
        case "QueryResult":
        case "ParquetScanResult":
            // we do not process our own results!
            break;
        case "DuckInstance":
            // repost to main.ts handler
            postMessage({nd_type:"DuckInstance"});
            break;
        default:
            console.error("duck_module.onmessage: unexpected request: ", event);
    }
};