import * as ImGui from "imgui-js";
import * as ImGui_Impl from "./imgui_impl.js";
import { ShowDemoWindow } from "./imgui_demo.js";
import { MemoryEditor } from "./imgui_memory_editor.js";

// Global UI state
let show_demo_window: boolean = false;
let show_memory_use: boolean = false;
let show_another_window: boolean = false;
let show_id_stack: boolean = false;
const clear_color: ImGui.Vec4 = new ImGui.Vec4(0.45, 0.55, 0.60, 1.00);

const memory_editor: MemoryEditor = new MemoryEditor();
memory_editor.Open = false;

/* static */ let f: number = 0.0;
/* static */ let counter: number = 0;

let done: boolean = false;

interface Materialized {
    query_id:string,
    result_type:string,
    rows:any[],
    names:string[],
    types:string[]
}

var empty_table:Materialized = {
    query_id:"<query_id>",
    result_type:"select",
    rows:[],
    names:[],
    types:[]
};

async function LoadArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response: Response = await fetch(url);
    return response.arrayBuffer();
}

// index.html gets hold of this entry point func with System.import("main")
export default async function main(): Promise<void> {
    await ImGui.default();
    if (typeof(window) !== "undefined") {
        window.requestAnimationFrame(_init);
    } else {
        async function _main(): Promise<void> {
            await _init();
            for (let i = 0; i < 3; ++i) { _loop(1 / 60); }
            await _done();
        }
        _main().catch(console.error);
    }
}


// An initial cache value supplied by /api/cache
// Here we permit nesting via array and obj, but no classes
type CacheValue = string | number | boolean | CacheObject | CacheArray;
interface CacheObject {
  [key: string]: CacheValue;
}
interface CacheArray extends Array<CacheValue> {}
type CacheMap = Map<string,CacheValue>;
type CacheMapEntry = {[key: string]: CacheValue};


// for parsing /api/layout
type RenderFunc = (ctx:NDContext, w:Widget) => void;
function default_render_func(ctx:NDContext, w: Widget): void {
    console.error("${w.rname} unresolved");
}


// Used for ingesting layout JSON
interface Widget {
    widget_id?:string;  // mandatory for non child layout elements
    rname:string;
    rfunc?:RenderFunc;
    cspec:CacheMap;
    children?:Widget[];
    // TS index signature so we can use [] as accessor
    [key: string]: undefined | string | RenderFunc | CacheMap | Widget[];
}


class Cached<T> {
    // access: a func that returns the current val if value param not supplied
    //         else if given a new value it's saved in this.value
    access: ImGui.Access<T> = (value: T = this.value): T => {
        if (this.value != value) {
            this.ctx.notify_server_atomic(this, value);
        }
        this.value = value;
        return this.value;
    }
    
    constructor(private ctx:NDContext, public value: T, public cache_key: string = "") { }
}

// type decl for Map<string,Cached<any>> to ease the
// use of [... as keyof ...] 
type CachedAnyMap = Map<string,Cached<any>>;

// Note init_val?:T which allows us to invoke without
// an init_val when we are doing a "get" rather than a 
// set.
function cache_access<T>(ctx:NDContext, ckey: string, init_val?: T): Cached<T> {
    let value: Cached<T> | undefined = ctx.cache.get(ckey);
    if (value === undefined) {
        // There's no cached val...
        if (init_val !== undefined) {
            // Initial value has been provided eg we have been
            // called with an initial value, so we are at
            // creation time for this cache entry
            ctx.cache.set(ckey, value = new Cached<T>(ctx, init_val, ckey));
        }
        else {
            // No init_value provided, so this must be a "get"
            // not a "set". And we don't have a cache value.
            // So error, and throw an exception as we cannot
            // return a Cached<T>...
            let error_message:string = "cache_access<T>: no cached val for " + ckey;
            console.log(error_message);
            throw error_message;
        }
    }
    return value;
}

function is_result_set(val:any): boolean {
    if (!val.hasOwnProperty('query_id')) return false;
    return true;
}

// Messages sent from GUI to server
interface DataChange {
    nd_type:string;
    old_value:any|null;
    new_value:any|null;
    cache_key:string;
}

interface DuckOp {
    nd_type:string;
    db_type:string;
    sql:string;
}

interface DuckResultSet {
    query_id:string;
    result_type:string;
    rows:any[];
    names:string[];
    types:string[];
}


function dispatch_render(ctx:NDContext, w: Widget): void {
    // Attempt to resolve rname to rfunc if not initialized
    if (!w.rfunc) {
        w.rfunc = ctx.rfmap.get(w.rname);
    }
    if (w.rfunc) {
        w.rfunc(ctx, w);            // invoke render func
        ctx.restore_defaults();     // restore defaults for next func
    }
    else {
        console.log('dispatch_render: missing render func: ' + w.rname);
    }
}


function render_container(ctx:NDContext, w: Widget): void {
    // TODO: get canvas style position from Home cspec
    // We may want to switch to having canvas config in the
    // data cache, so it can change during GUI lifetime. Not
    // the layout cache as that only addresses what happens
    // _inside_ a canvas.
    /**
    var gui_width = w.cspec["gui_canvas_style_width" as keyof CacheMap] as string;
    let gui_height = w.cspec["gui_canvas_style_width" as keyof CacheMap] as string;
    let shell_left = w.cspec["shell_canvas_style_left" as keyof CacheMap] as string;
    let shell_top = w.cspec["shell_canvas_style_top" as keyof CacheMap] as string;
    if (gui_width && gui_height) {           
        if (gui_width !== _nd_ctx.gui_width) {
            console.log("check_canvas_config: gui_width:" + _nd_ctx.gui_width);
        }        
    }
    let shell_canvas_container:any = document.getElementById("nodom_duck_shell_div");
    if (shell_canvas_container?.firstChild) {
        let shell_canvas:any = shell_canvas_container.firstChild;
        if (shell_left) shell_canvas.style.left = shell_left;
        if (shell_top) shell_canvas.style.left = shell_top;
    } */
    if (w.children) w.children.forEach( (w) => {dispatch_render(ctx, w);});
}


function render_home(ctx:NDContext, w: Widget): void {
    // as keyof CacheMap clause here is critical
    // as w.cspec["title"] will not compile...
    let title = w.cspec["title" as keyof CacheMap] as string;
    ImGui.Begin(title ? title : "nodom");
    render_container(ctx, w);
    ImGui.End();
}


function render_input_int(ctx:NDContext, w: Widget): void {
    if ("step" in w.cspec) {
        ctx.step = w.cspec["step" as keyof CacheMap] as number;
    }
    if ("step_fast" in w.cspec) {
        ctx.step_fast = w.cspec["step_fast" as keyof CacheMap] as number;
    }
    if ("flags" in w.cspec) {
        // See src/imgui.ts:InputTextFlags
        ctx.flags = w.cspec["flags" as keyof CacheMap] as number;
    }
    let cache_name = w.cspec["cname" as keyof CacheMap] as string;
    const accessor = cache_access<number>(ctx, cache_name);
    let label = w.cspec["label" as keyof CacheMap] as string;
    if (label === undefined) label = cache_name;
    // NB when InputInt invokes accessor.access(new_int_val) to set the int in the cache
    // accessor.access() will invoke ctx.notify_server()
    ImGui.InputInt(label, accessor.access, ctx.step, ctx.step_fast, ctx.flags);
}


function render_combo(ctx:NDContext, w: Widget): void {
    let label = w.cspec["label" as keyof CacheMap] as string;    
    let list_ckey = w.cspec["cname" as keyof CacheMap] as string;
    let index_ckey = w.cspec["index" as keyof CacheMap] as string;
    const list_accessor = cache_access<any>(ctx, list_ckey);
    const index_accessor = cache_access<number>(ctx, index_ckey);
    // NB when InputInt invokes accessor.access(new_int_val) to set the int in the cache
    // accessor.access() will invoke ctx.notify_server()
    ImGui.Combo(label, index_accessor.access, list_accessor.value, ImGui.ARRAYSIZE(list_accessor.value.length));
}


function render_text(ctx:NDContext, w: Widget): void {
    let rtext = w.cspec["text" as keyof CacheMap] as string;
    ImGui.Text(rtext);
}


function render_separator(ctx:NDContext, w: Widget): void {
    ImGui.Separator();
}


function render_same_line(ctx:NDContext, w: Widget): void {
    ImGui.SameLine();
}


function render_button(ctx:NDContext, w: Widget): void {
    let btext = w.cspec["text" as keyof CacheMap] as string;

    if (ImGui.Button(btext)) {
        ctx.action_dispatch(w.cspec);
    }
}


function render_duck_table_summary_modal(ctx:NDContext, w: Widget): void {
    let title = w.cspec["title" as keyof CacheMap] as string;
    let cname = w.cspec["cname" as keyof CacheMap] as string;
    if ("flags" in w.cspec) {
        // See src/imgui.ts:InputTextFlags
        ctx.flags = w.cspec["table_flags" as keyof CacheMap] as number;
    }
    else {
        ctx.flags = ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg;
    }
    console.log("render_duck_table_summary_modal: cname:" + cname + ", title:" + title);
    ImGui.OpenPopup(title);

    // Always center this window when appearing
    const center = ImGui.GetMainViewport().GetCenter();
    ImGui.SetNextWindowPos(center, ImGui.Cond.Appearing, new ImGui.Vec2(0.5, 0.5));

    if (ImGui.BeginPopupModal(title, null, ImGui.WindowFlags.AlwaysAutoResize)) {
        const summary_accessor = cache_access<any>(ctx, cname);

        // 12 cols in summary
        if (ImGui.BeginTable(cname, summary_accessor.value.names.length, ctx.flags)) {
            for (let col_index = 0; col_index < summary_accessor.value.names.length; col_index++) {
                ImGui.TableSetupColumn(summary_accessor.value.names[col_index]);
            }
            ImGui.TableHeadersRow();

            for (let row_index = 0; row_index < summary_accessor.value.rows.length; row_index++) {
                let row = summary_accessor.value.rows[row_index];
                ImGui.TableNextRow();
                for (let col_index = 0; col_index < summary_accessor.value.names.length; col_index++) {
                    ImGui.TableSetColumnIndex(col_index);
                    let property:string = summary_accessor.value.names[col_index];
                    let cell = row[property] as unknown;
                    let ctype = summary_accessor.value.types[col_index];
                    if (cell) {
                        switch (ctype.typeId) {
                            case 2: // BIGINT
                            case 5: // bigint
                                ImGui.TextUnformatted(cell.toString());
                                break;
                            case 3: // decimal as double
                                ImGui.TextUnformatted(cell.toString());
                                break;
                            case 7: // decimal as Uint32Array
                                console.error("render_duck_table_summary_modal: decimal at row/col: " + row_index + "/" + col_index);
                                break;
                            default:
                                try {
                                    ImGui.TextUnformatted(cell as string);
                                }
                                catch (error) {
                                    console.error("render_duck_table_summary_modal: unknown at row/col: " + row_index + "/" + col_index);
                                }
                                break;
                        }                        
                    }
                }
            }
            ImGui.EndTable();
        }
        
        // ImGui.Text("PLACEHOLDER");
        ImGui.Separator();

        // Note the _nd_ctx.stack.pop() invocations when
        // OK or Cancel are shown. Because we're a modal,
        // we know we're now a Home child, so we must have
        // been pushed onto the stack...
        if (ImGui.Button("OK", new ImGui.Vec2(120, 0))) {
            ImGui.CloseCurrentPopup();
            _nd_ctx.pop("DuckTableSummaryModal");
        }
        ImGui.SetItemDefaultFocus();
        ImGui.SameLine();
        if (ImGui.Button("Cancel", new ImGui.Vec2(120, 0))) { 
            ImGui.CloseCurrentPopup();
            _nd_ctx.pop("DuckTableSummaryModal");
        }
        ImGui.EndPopup();
    }
}


function render_duck_parquet_loading_modal(ctx:NDContext, w: Widget): void {
    let title = w.cspec["title" as keyof CacheMap] as string;
    let cname = w.cspec["cname" as keyof CacheMap] as string;   // scan_urls in cache
    console.log("render_duck_parquet_loading_modal: cname:" + cname + ", title:" + title);
    ImGui.OpenPopup(title);

    // Always center this window when appearing
    const center = ImGui.GetMainViewport().GetCenter();
    ImGui.SetNextWindowPos(center, ImGui.Cond.Appearing, new ImGui.Vec2(0.5, 0.5));

    if (ImGui.BeginPopupModal(title, null, ImGui.WindowFlags.AlwaysAutoResize)) {
        const url_list_accessor = cache_access<any>(ctx, cname);
        for (let url_index = 0; url_index < url_list_accessor.value.length; url_index++) {
            ImGui.Text(url_list_accessor.value[url_index]);
        }
        /** TODO: debug spinner */
        if (!ImGui.Spinner("parquet_loading_spinner", 5, 2, 0)) {
            // TODO: why doesn't spinner work?
            console.error("render_duck_parquet_loading_modal: spinner fail");
        }
        ImGui.EndPopup();
    }
}


// main GUI footer
function render_footer(ctx:NDContext, w: Widget): void {
    ctx.footer_db = w.cspec["db" as keyof CacheMap] as unknown as boolean;
    ctx.footer_fps = w.cspec["fps" as keyof CacheMap] as unknown as boolean;
    ctx.footer_demo = w.cspec["demo" as keyof CacheMap] as unknown as boolean;
    ctx.footer_id_stack = w.cspec["id_stack" as keyof CacheMap] as unknown as boolean;
    ctx.footer_memory = w.cspec["memory" as keyof CacheMap] as unknown as boolean;                 
                  
    if (ctx.footer_db) {
        // Push colour styling for the DB button
        ImGui.PushStyleColor(ImGui.Col.Button, ctx.db_status_color);
        if (ImGui.Button("DB")) {
            if (typeof(window) !== "undefined") {
                window.open(_nd_ctx.duck_journal_url);
            }
        }
        ImGui.PopStyleColor(1);
    }
    if (ctx.footer_fps) {
        ImGui.SameLine();
        ImGui.Text(`${ctx.io!.Framerate.toFixed(1)} FPS avg ${(1000.0 / ctx.io!.Framerate).toFixed(3)} ms/frame`);
    }
    if (ctx.footer_id_stack) {
        ImGui.Checkbox("ID Stack", (value = show_id_stack) => show_id_stack = value);
        ImGui.SameLine();
    }
    if (ctx.footer_memory) {
        ImGui.Checkbox("Mem use", (value = show_memory_use) => show_memory_use = value);
        ImGui.SameLine();
        ImGui.Checkbox("Mem edit", (value = memory_editor.Open) => memory_editor.Open = value);
        ImGui.SameLine();
        ImGui.Checkbox("Demo", (value = show_demo_window) => show_demo_window = value);      // Edit bools storing our windows open/close state  
    }
    // TODO: add ID stack here...
    if (ctx.footer_id_stack && show_id_stack) {
        ImGui.ShowStackToolWindow();
    }
    if (memory_editor.Open) {
        ImGui.SameLine();
        memory_editor.DrawWindow("Memory Editor", ImGui.bind.HEAP8.buffer);

    }
    if (show_memory_use && ctx.footer_memory) {
        const mi: ImGui.Bind.mallinfo = ImGui.bind.mallinfo();
        // ImGui.Text(`Total non-mmapped bytes (arena):       ${mi.arena}`);
        // ImGui.Text(`# of free chunks (ordblks):            ${mi.ordblks}`);
        // ImGui.Text(`# of free fastbin blocks (smblks):     ${mi.smblks}`);
        // ImGui.Text(`# of mapped regions (hblks):           ${mi.hblks}`);
        // ImGui.Text(`Bytes in mapped regions (hblkhd):      ${mi.hblkhd}`);
        ImGui.Text(`Max. total allocated space (usmblks):  ${mi.usmblks}`);
        // ImGui.Text(`Free bytes held in fastbins (fsmblks): ${mi.fsmblks}`);
        ImGui.Text(`Total allocated space (uordblks):      ${mi.uordblks}`);
        ImGui.Text(`Total free space (fordblks):           ${mi.fordblks}`);
    }
       
    if (ctx.font) {
        ImGui.PushFont(ctx.font);
        ImGui.Text(`${ctx.font.GetDebugName()}`);
        if (ctx.font.FindGlyphNoFallback(0x5929)) {
            ImGui.Text(`U+5929: \u5929`);
        }
        ImGui.PopFont();
    }
}   


function render_date_picker(ctx:NDContext, w: Widget): void {
    if ("clamp" in w.cspec) {
        // Coerce type narrowing to bool via unknown
        ctx.clamp = w.cspec["clamp" as keyof CacheMap] as unknown as boolean;
    }
    if ("table_flags" in w.cspec) {
        // See src/imgui.ts:TableFlags
        ctx.flags = w.cspec["table_flags" as keyof CacheMap] as number;
    }
    else {
        // Explicit defaulting of table_flags to match original datepicker 
        // behaviour, otherwise we get restore_defaults() value
        ctx.flags = ImGui.TableFlags.BordersOuter | ImGui.TableFlags.SizingFixedFit |
                ImGui.TableFlags.NoHostExtendX | ImGui.TableFlags.NoHostExtendY;
    }

    if ("table_size" in w.cspec) {
        // See src/imgui.ts:TableFlags
        ctx.anyw = w.cspec["table_size" as keyof CacheMap] as any;
    }
    else {
        // Original datepicker hardwired consts
        ctx.anyw = [274.5,301.5];
    }
    let cache_name = w.cspec["cname" as keyof CacheMap] as string;
    // NB the use of accessor.value, not .access, since the underlying val is
    // an array. Bear in mind that in C++land an int[] is int*.
    const accessor = cache_access<ImGui.Tuple3<number>>(ctx, cache_name);
    // Store the old val as DatePicker will overwrite the cached val
    // Unrolled loop copy...
    ctx.num_tuple3[0] = accessor.value[0];
    ctx.num_tuple3[1] = accessor.value[1];
    ctx.num_tuple3[2] = accessor.value[2];
    // Since we've passed in accessor.value rather than .access, we have
    // to check the bool ret val to see if the date has changed...
    if (ImGui.DatePicker(cache_name, accessor.value, ctx.anyw, ctx.clamp, ctx.flags)) {
        ctx.notify_server_any(accessor, ctx.num_tuple3);
        console.log('render_date_picker: ' + accessor.value);
    }
}


function render_table(ctx:NDContext, w: Widget): void {
    let title = w.cspec["title" as keyof CacheMap] as string;
    let cname = w.cspec["cname" as keyof CacheMap] as string;
    if ("flags" in w.cspec) {
        // See src/imgui.ts:ImGui.TableFlags.Borders
        ctx.flags = w.cspec["table_flags" as keyof CacheMap] as number;
    }
    else {
        ctx.flags = ImGui.TableFlags.Borders | ImGui.TableFlags.RowBg;
    }
    console.log("render_table: cname:" + cname + ", title:" + title);
    const table_accessor = cache_access<any>(ctx, cname, empty_table);
    if (ImGui.BeginTable(cname, table_accessor.value.names.length, ctx.flags)) {
            for (let col_index = 0; col_index < table_accessor.value.names.length; col_index++) {
                ImGui.TableSetupColumn(table_accessor.value.names[col_index]);
            }
            ImGui.TableHeadersRow();

            for (let row_index = 0; row_index < table_accessor.value.rows.length; row_index++) {
                let row = table_accessor.value.rows[row_index];
                ImGui.TableNextRow();
                for (let col_index = 0; col_index < table_accessor.value.names.length; col_index++) {
                    ImGui.TableSetColumnIndex(col_index);
                    let property:string = table_accessor.value.names[col_index];
                    let cell = row[property] as unknown;
                    let ctype = table_accessor.value.types[col_index];
                    if (cell) {
                        switch (ctype.typeId) {
                            case 2: // BIGINT
                            case 5: // bigint
                                ImGui.TextUnformatted(cell.toString());
                                break;
                            case 3: // decimal as double
                                ImGui.TextUnformatted(cell.toString());
                                break;
                            case 7: // decimal as Uint32Array
                                console.error("render_duck_table_summary_modal: decimal at row/col: " + row_index + "/" + col_index);
                                break;
                            default:
                                try {
                                    ImGui.TextUnformatted(cell as string);
                                }
                                catch (error) {
                                    console.error("render_duck_table_summary_modal: unknown at row/col: " + row_index + "/" + col_index);
                                }
                                break;
                        }                        
                    }
                }
            }
            ImGui.EndTable();
        }

}


let nd_url = (locn:Location, upath:string): string => {
    return locn.protocol + "//" + locn.hostname + ":" + locn.port + upath;
};


// Use node-fetch for HTTP GET as it's already in package-lock.json
// https://stackoverflow.com/questions/45748476/http-request-in-typescript
// Use websocket-ts for websock via "npm install websocket-ts"
// https://www.npmjs.com/package/websocket-ts
class NDContext {
    websock: WebSocket|null = null;             // Backe end connection
    layout: Widget[] = [];                      // as served by /api/layout 
    stack: Widget[] = [];                       // widgets currently rendering
    pushable: Map<string, Widget> = new Map<string, Widget>();
    // data from backend
    cache: CachedAnyMap = new Map<string,Cached<any>>();   
    // Map of render functions reffed in layouts
    rfmap: Map<string, RenderFunc> = new Map<string, RenderFunc>([
            ["Home", render_home],
            ["InputInt", render_input_int],
            ["Combo", render_combo],
            ["Separator", render_separator],
            ["Footer", render_footer],
            ["SameLine", render_same_line],
            ["DatePicker", render_date_picker],
            ["Text", render_text],
            ["Button", render_button],
            ["DuckTableSummaryModal", render_duck_table_summary_modal],
            ["DuckParquetLoadingModal", render_duck_parquet_loading_modal],
            ["Table", render_table],
        ]);      // render functions    
    // consts
    update_interval: number = 50;
    init_interval: number = 1000;
    // fonts
    font: ImGui.Font|null = null;
    io: ImGui.IO|null = null;
    // colours: https://www.w3schools.com/colors/colors_picker.asp
    red: number = ImGui.COL32(255, 51, 0);
    green: number = ImGui.COL32(102, 153, 0);
    amber: number = ImGui.COL32(255, 153, 0);
    db_status_color: number = ImGui.COL32(255, 51, 0);
    // handle to Home layout
    home: any|null = null;          
    // URLs
    duck_journal_url:string = "UNINITIALIZED";
    // working vars so we can avoid the use of locals in render funcs
    // NB only one thread is touching this stuff!
    step: number = 1;
    step_fast: number = 1;
    flags: number = 0;
    clamp: boolean = false;
    anyw: any | null = null;
    num_tuple3: ImGui.Tuple3<number> = [0, 0, 0];
    footer_db: boolean = true;
    footer_fps: boolean = true;
    footer_demo: boolean = true;
    footer_id_stack: boolean = true;
    footer_memory: boolean = true;    
    data_change_msg: DataChange = {nd_type:"DataChange", old_value:null, new_value:null, cache_key:""};
    duck_op_msg: DuckOp = {nd_type:"DuckOp", db_type:"", sql:""};
    cache_ref:Cached<any>|undefined;
    canvas: HTMLCanvasElement | null = null;
    // initial gui canvas top, left, right, bottom, width, height
    // NB yes they are strings as they're in a styling context
    // so may be "100px" or "100%".
    gui_position:string = "absolute";
    gui_left:string = "0px";
    gui_right:string = "0px";
    gui_top:string = "0px";
    gui_bottom:string = "0px";
    gui_width:string = "100%";
    gui_height:string = "100%";
    shell_left:string = "100px";
    // will only become !== null if we have module JS for Duck
    // instantiation in index.html
    duck_module:any|null = null;
    pending_websock_msgs:any[] = [];
    // DuckDB summary tables
    duck_summary: Map<string, any> = new Map<string, any>();
        
    
    constructor() {
        this.restore_defaults();
        this.cache_ref = new Cached<number>(this, 0, "0");
    }
    
    restore_defaults(): void {
        this.step = 1;
        this.step_fast = 1;
        this.flags = 0;
    }

    async load_font_ttf(url: string, size_pixels: number, font_cfg: ImGui.FontConfig | null = null, glyph_ranges: number | null = null): Promise<ImGui.Font> {
        this.io = ImGui.GetIO();
        this.io.Fonts.AddFontDefault();
        font_cfg = font_cfg || new ImGui.FontConfig();
        font_cfg.Name = font_cfg.Name || `${url.split(/[\\\/]/).pop()}, ${size_pixels.toFixed(0)}px`;
        return this.io.Fonts.AddFontFromMemoryTTF(await LoadArrayBuffer(url), size_pixels, font_cfg, glyph_ranges);
    }

    async init(): Promise<number> {
        if (typeof(window) === "undefined") return 0;
        
        // Some standard URLs recognised on the server side
        // TODO: config port 8090
        let websock_url = nd_url(window.location, "/api/websock");
        let layout_url = nd_url(window.location, "/api/layout");
        let data_url = nd_url(window.location, "/api/data");
        // Initialize WebSocket with buffering and 1s reconnection delay
        this.websock = new WebSocket(websock_url);
        this.websock.onopen = this.on_open;
        this.websock.onclose = this.on_close;
        this.websock.onmessage = this.on_websock_message;
        // Pull cache init from server
        const cache_response = await window.fetch(data_url);
        const cache_json = await cache_response.text();
        console.log('NDContext.init: ' + cache_json);
        let cache_init = await JSON.parse(cache_json);
        for (let ckey in cache_init) {
            // Extract the type and instance correct <T> for CacheAccess
            // https://stackoverflow.com/questions/35546421/how-to-get-a-variable-type-in-typescript
            let val = cache_init[ckey];
            let val_type = typeof val;  // JS type
            if (typeof val === "number") {
                this.cache.set(ckey, new Cached<number>(this, val, ckey));
            }
            else if (typeof val === "string") {
                this.cache.set(ckey, new Cached<string>(this, val, ckey));
            }
            else { 
                this.cache.set(ckey, new Cached<any>(this, val, ckey));
            }
            console.log('NDContext.init: '+ckey+':'+val+':'+val_type);             
        }
        // HTTP GET to fetch layout description in JSON
        // TODO: fetch error handler that can raise a modal...
        const layout_response = await window.fetch(layout_url);
        const layout_json = await layout_response.text();
        console.log('NDContext.init: ' + layout_json);
        this.layout = JSON.parse(layout_json) as Array<Widget>;
        this.layout.forEach( (w) => {if (w.widget_id) this.pushable.set(w.widget_id, w);});
        // Load font: TODO module JS script font config
        console.log('NDContext.init: loading fonts');
        this.font = await this.load_font_ttf("../imgui/misc/fonts/Roboto-Medium.ttf", 16.0);
        ImGui.ASSERT(this.font !== null);

        // Finally, tee up the first element in layout to render: home
        this.push(this.layout[0]);

        return 0;
    }
    
    
    on_open(ev: any): void {
        console.log("Websock connected");
    }
    
    on_close(ev: any): void {
        console.log("Websock closed");
    }
    
    on_data_change(msg:DataChange): void {
        if (typeof msg.new_value === "number") {
            const accessor = cache_access<number>(_nd_ctx, msg.cache_key);
            accessor.value = msg.new_value;
        }
        else if (typeof msg.new_value === "string") {
            const accessor = cache_access<string>(_nd_ctx, msg.cache_key);
            accessor.value = msg.new_value;
        }
        else {
            this.cache.set(msg.cache_key, new Cached<any>(this, msg.new_value));
        }
    }
    
    on_websock_message(ev: any): void {
        // NB we're in a websock callback here, so "this" is not
        // the NDContext instance, it's the websock
        console.log('NDContext.on_websock_message: ' + ev.data);
        let msg:any = JSON.parse(ev.data);
        switch (msg.nd_type) {
            case "DataChange":
                _nd_ctx.on_data_change(msg);
                break;
            case "ParquetScan":
                _nd_ctx.duck_dispatch(msg);
                break;
            case "DuckOpUUID":
                _nd_ctx.duck_journal_url = nd_url(window.location, "/ui/duckjournal/" + msg.uuid);
            default:
                break;
        }
    }
    
    websock_send(msg:string): void {
        if (this.websock !== null) {
            // NB need the ? after websock as TS errors despite the
            // if clause with TS2531: Object is possibly 'null'
            // on this.websock.send()
            this.pending_websock_msgs.forEach(m => this.websock?.send(m));
            this.pending_websock_msgs.length = 0;
            this.websock.send(msg);
        }
        else {
            this.pending_websock_msgs.push(msg);
            console.log('NDContext.websock_send: pending msg count ' + this.pending_websock_msgs.length);
        }
    }

    // see Cached<T> caching logic for comments on why atomics
    // and non atomics are handled differently
    notify_server_atomic(accessor:Cached<any>, new_val:any): void {
        this.data_change_msg.old_value = accessor.value;
        this.data_change_msg.new_value = new_val;
        this.data_change_msg.cache_key = accessor.cache_key;
        this.websock_send(JSON.stringify(this.data_change_msg));
    }

    notify_server_any(accessor:Cached<any>, old_val:any): void {
        this.data_change_msg.new_value = accessor.value;
        this.data_change_msg.old_value = old_val;
        this.data_change_msg.cache_key = accessor.cache_key;
        this.websock_send(JSON.stringify(this.data_change_msg));
    }
    
    notify_server_duckop(db_request:any): void {
        this.duck_op_msg.db_type = db_request.nd_type;
        this.duck_op_msg.sql = db_request.sql;
        this.websock_send(JSON.stringify(this.duck_op_msg));
    }
    
    check_duck_module(): void {
        // Contingent DDBW init: duck_handler only goes to a real value
        // if index.html included the DuckDB init embedded module.
        let dmod:any|null = (window as any)?.__nodom__?.duck_module || null;
        if (dmod && !this.duck_module) {
            // flip the status button to amber
            this.db_status_color = this.amber;
            this.duck_module = dmod;
            dmod.addEventListener('message', this.on_duck_event);
            console.log('NDContext.check_duck_handler: window.__nodom__.duck_module recved');
            // send a test query
            this.duck_dispatch({nd_type:"Query", sql:"select 1729;"});
        }       
    }    

    duck_dispatch(db_request:any): void {
        if (!this.duck_module) {
            console.error("NDContext.duck_dispatch: no DB connection to dispatch ", db_request);
        }
        this.duck_module.postMessage(db_request);
        this.notify_server_duckop(db_request);
    }
    
    on_duck_event(event:any): void {
        // NB see event handler setup in check_duck_module: it's dispatched
        // from the duck module, so the "this" will not be the NDContext
        // singleton, it will be the duck module.
        console.log('NDContext.on_duck_event: ', event.data);
        const nd_db_request = event.data;
        switch (nd_db_request.nd_type) {
            case "ParquetScan":
            case "Query":
                // go amber while query or scan is in progress
                _nd_ctx.db_status_color = _nd_ctx.amber;
                break;
            case "ParquetScanResult":
                _nd_ctx.db_status_color = _nd_ctx.green;
                if (nd_db_request.result.result_type === "summary") {
                    _nd_ctx.cache.set("db_summary_"+nd_db_request.result.query_id,
                                        new Cached<any>(_nd_ctx, nd_db_request.result));
                }
                _nd_ctx.pop("DuckParquetLoadingModal");
                console.log("NDContext.on_duck_event: QueryResult rows:" + nd_db_request.result.rows.length + " cols:" + nd_db_request.result.names.length);
                break;
            case "QueryResult":
                _nd_ctx.db_status_color = _nd_ctx.green;
                console.log("NDContext.on_duck_event: QueryResult rows:" + nd_db_request.result.rows.length + " cols:" + nd_db_request.result.names.length);
                break;
            case "DuckInstance":
                // duck_module.js has created the duck_db instance
                // this is the way we'd like it to work, rather than
                // invoking on each render...
                _nd_ctx.check_duck_module();
                break;
            default:
                console.error("NDContext.on_duck_event: unexpected DB request type: ", event.data);
        }

    }
    
    action_dispatch(cspec:CacheMap): void {
        let action = cspec["action" as keyof CacheMap] as string;
        switch (action) {
            case "ParquetScan":
                let sql_cache_key = cspec["sql" as keyof CacheMap] as string;
                let qid_cache_key = cspec["query_id" as keyof CacheMap] as string;
                let modal_id = cspec["modal" as keyof CacheMap] as string;
                const sql_accessor = cache_access<string>(this, sql_cache_key);
                const qid_accessor = cache_access<string>(this, qid_cache_key);
                this.duck_dispatch( {
                    nd_type:action,
                    sql:sql_accessor.value,
                    query_id:qid_accessor.value,
                });
                // if we have a widget_id='parquet_loading_modal' in layout raise it
                if (modal_id && this.pushable.has(modal_id)) {
                    this.push(this.pushable.get(modal_id) as Widget);
                }
                break;
            default:
                // is it a pushable widget?
                // NB this is only for self popping modals like DuckTableSummaryModal
                if (this.pushable.has(action)) {
                    this.push(this.pushable.get(action) as Widget);
                }
                else {
                    console.error("NDContext.action_dispatch: unrecognised " + action);
                }
                break;
        }
    }
    
    render(): void {
        // unfortunately we have to poll for window.__nodom__ changes
        // as shell_module.js cannot postMessage to here until we've
        // added an eventListener to shell_module in check_duck_module.
        // TODO: Can we export a TS func from here to copy the duck_db
        // handle into a main.ts static var?
        this.check_duck_module();        
        // fire the render methods of all the widgets on the stack
        // starting with the bottom of the stack: NDHome
        // console.log('NDContext.render: child count ' + this.stack.length);
        for (let widget of this.stack) {
            dispatch_render(this, widget);
        } 
    }
    
    push(layout_element:Widget): void {
        this.stack.push(layout_element);
    }
    
    pop(rname:string=""): void {
        let layout_element:Widget = this.stack.pop() as Widget;
        if (rname) {
            if (rname !== layout_element.rname) {
                console.error("NDContext.pop: bad pop: expected " + rname +
                    "and got " + layout_element.rname);
            }
        }
    }
    
    create_canvas(): HTMLCanvasElement {
        const output: HTMLElement = document.getElementById("nodom_gui_div") || document.body;
        this.canvas = document.createElement("canvas");
        output.appendChild(this.canvas);
        this.canvas.id = "nodom_gui_canvas";
        this.canvas.tabIndex = 1;
        this.canvas.style.position = this.gui_position;
        this.canvas.style.left = this.gui_left;
        this.canvas.style.right = this.gui_right;
        this.canvas.style.top = this.gui_top;
        this.canvas.style.bottom = this.gui_bottom;
        this.canvas.style.width =  this.gui_width;
        this.canvas.style.height = this.gui_height;
        this.canvas.style.userSelect = "none";
        this.canvas.style.zIndex = "0"; // duck shell canvas will flip between -1/1
        // this.canvas.style.globalAlpha = "1.0";
        return this.canvas;
    }
}

let _nd_ctx: NDContext = new NDContext();


async function _init(): Promise<void> {
    // TODO: why isn't this working?
    const EMSCRIPTEN_VERSION = `${ImGui.bind.__EMSCRIPTEN_major__}.${ImGui.bind.__EMSCRIPTEN_minor__}.${ImGui.bind.__EMSCRIPTEN_tiny__}`;
    console.log("Emscripten Version", EMSCRIPTEN_VERSION);
    console.log("Total allocated space (uordblks) @ _init:", ImGui.bind.mallinfo().uordblks);

    // Setup Dear ImGui context
    ImGui.CHECKVERSION();
    ImGui.CreateContext();
    // const io: ImGui.IO = ImGui.GetIO();
    //io.ConfigFlags |= ImGui.ConfigFlags.NavEnableKeyboard;     // Enable Keyboard Controls
    //io.ConfigFlags |= ImGui.ConfigFlags.NavEnableGamepad;      // Enable Gamepad Controls

    // Setup Dear ImGui style
    ImGui.StyleColorsDark();
    //ImGui.StyleColorsClassic();

    // Load Fonts
    // - If no fonts are loaded, dear imgui will use the default font. You can also load multiple fonts and use ImGui::PushFont()/PopFont() to select them.
    // - AddFontFromFileTTF() will return the ImFont* so you can store it if you need to select the font among multiple.
    // - If the file cannot be loaded, the function will return NULL. Please handle those errors in your application (e.g. use an assertion, or display an error and quit).
    // - The fonts will be rasterized at a given size (w/ oversampling) and stored into a texture when calling ImFontAtlas::Build()/GetTexDataAsXXXX(), which ImGui_ImplXXXX_NewFrame below will call.
    // - Read 'docs/FONTS.md' for more instructions and details.
    // - Remember that in C/C++ if you want to include a backslash \ in a string literal you need to write a double backslash \\ !
    // io.Fonts.AddFontDefault();
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/Roboto-Medium.ttf", 16.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/Cousine-Regular.ttf", 15.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/DroidSans.ttf", 16.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/ProggyTiny.ttf", 10.0);
    // font = await AddFontFromFileTTF("c:\\Windows\\Fonts\\ArialUni.ttf", 18.0, null, io.Fonts.GetGlyphRangesJapanese());
    // font = await AddFontFromFileTTF("https://raw.githubusercontent.com/googlei18n/noto-cjk/master/NotoSansJP-Regular.otf", 18.0, null, io.Fonts.GetGlyphRangesJapanese());
    // ImGui.ASSERT(font !== null);

    // Setup Platform/Renderer backends
    // ImGui_ImplSDL2_InitForOpenGL(window, gl_context);
    // ImGui_ImplOpenGL3_Init(glsl_version);
    if (typeof(window) !== "undefined") {
        ImGui_Impl.Init(_nd_ctx.create_canvas());
    } else {
        ImGui_Impl.Init(null);
    }
    
    if (typeof(window) !== "undefined") {
        // all the heavyweight init should be done here, before the animation loop starts
        // TODO: exception handling to raise modal dialog on connection failure
        await _nd_ctx.init();
        window.requestAnimationFrame(_loop);
    }
}

// Main loop
// async function _loop(time: number): Promise<void> {
function _loop(time: number): void {
    // Poll and handle events (inputs, window resize, etc.)
    // You can read the io.WantCaptureMouse, io.WantCaptureKeyboard flags to tell if dear imgui wants to use your inputs.
    // - When io.WantCaptureMouse is true, do not dispatch mouse input data to your main application.
    // - When io.WantCaptureKeyboard is true, do not dispatch keyboard input data to your main application.
    // Generally you may always pass all inputs to dear imgui, and hide them from your application based on those two flags.
    
    // Start the Dear ImGui frame
    ImGui_Impl.NewFrame(time);
    ImGui.NewFrame();

    // Show the big demo window (Most of the sample code is in ImGui::ShowDemoWindow()!
    // You can browse its code to learn more about Dear ImGui!).
    if (show_demo_window)
        ShowDemoWindow((value = show_demo_window) => show_demo_window = value);

    _nd_ctx.render();   

    ImGui.EndFrame();

    // Rendering
    ImGui.Render();
    const gl: WebGLRenderingContext | null = ImGui_Impl.gl;
    if (gl) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(clear_color.x, clear_color.y, clear_color.z, clear_color.w);
        gl.clear(gl.COLOR_BUFFER_BIT);
        //gl.useProgram(0); // You may want this if using this code in an OpenGL 3+ context where shaders may be bound
    }

    const gl_ctx: CanvasRenderingContext2D | null = ImGui_Impl.ctx;
    if (gl_ctx) {
        gl_ctx.fillStyle = `rgba(${clear_color.x * 0xff}, ${clear_color.y * 0xff}, ${clear_color.z * 0xff}, ${clear_color.w})`;
        gl_ctx.fillRect(0, 0, gl_ctx.canvas.width, gl_ctx.canvas.height);
    }

    ImGui_Impl.RenderDrawData(ImGui.GetDrawData());

    if (typeof(window) !== "undefined") {
        window.requestAnimationFrame(done ? _done : _loop);
    }
}

async function _done(): Promise<void> {
    const gl: WebGLRenderingContext | null = ImGui_Impl.gl;
    if (gl) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clearColor(clear_color.x, clear_color.y, clear_color.z, clear_color.w);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const ctx: CanvasRenderingContext2D | null = ImGui_Impl.ctx;
    if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // Cleanup
    ImGui_Impl.Shutdown();
    ImGui.DestroyContext();

    console.log("Total allocated space (uordblks) @ _done:", ImGui.bind.mallinfo().uordblks);
}

function ShowHelpMarker(desc: string): void {
    ImGui.TextDisabled("(?)");
    if (ImGui.IsItemHovered()) {
        ImGui.BeginTooltip();
        ImGui.PushTextWrapPos(ImGui.GetFontSize() * 35.0);
        ImGui.TextUnformatted(desc);
        ImGui.PopTextWrapPos();
        ImGui.EndTooltip();
    }
}
