import * as ImGui from "imgui-js";
import * as ImGui_Impl from "./imgui_impl.js";
import { ShowDemoWindow } from "./imgui_demo.js";
import { MemoryEditor } from "./imgui_memory_editor.js";



// Our state
let show_demo_window: boolean = false;
let show_another_window: boolean = false;
const clear_color: ImGui.Vec4 = new ImGui.Vec4(0.45, 0.55, 0.60, 1.00);

const memory_editor: MemoryEditor = new MemoryEditor();
memory_editor.Open = false;

let show_sandbox_window: boolean = false;
let show_gamepad_window: boolean = false;
let show_movie_window: boolean = false;

/* static */ let f: number = 0.0;
/* static */ let counter: number = 0;

let done: boolean = false;

async function LoadArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response: Response = await fetch(url);
    return response.arrayBuffer();
}

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

// This was an Interface. But that meant type info did
// not persist beyound compile time, causing problems
// with render methods recovering data from CacheMap.
interface Widget {
    rname:string;
    rfunc?:RenderFunc;
    cspec:CacheMap;
    children?:Widget[];
    // TS index signature so we can use [] as accessor
    [key: string]: undefined | string | RenderFunc | CacheMap | Widget[];
};


class Cached<T> {
    constructor(public value: T) {}
    access: ImGui.Access<T> = (value: T = this.value): T => this.value = value;
}

function accessor_factory<T>(ctx:NDContext, key: string, initial_value: T): Cached<T> {
    let value: Cached<T> | undefined = ctx.cache.get(key);
    if (value === undefined) { ctx.cache.set(key, value = new Cached<T>(initial_value)); }
    return value;
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


function render_container(ctx:NDContext, widget: Widget): void {
    if (widget.children) widget.children.forEach( (w) => {dispatch_render(ctx, w);});
}


function render_home(ctx:NDContext, w: Widget): void {
    // as keyof CacheMap clause here is critical
    // as w.cspec["title"] will not compile...
    var title = w.cspec["title" as keyof CacheMap] as string;
    ImGui.Begin(title ? title : "nodom");
    render_container(ctx, w);
    ImGui.End();
}


function render_input_int(ctx:NDContext, w: Widget): void {
    // ImGui.InputTextFlags.ReadOnly
    if ("step" in w.cspec) {
        ctx.step = w.cspec["step" as keyof CacheMap] as number;
    }
    if ("step_fast" in w.cspec) {
        ctx.step_fast = w.cspec["step_fast" as keyof CacheMap] as number;
    }
    if ("flags" in w.cspec) {
        ctx.flags = w.cspec["flags" as keyof CacheMap] as number;
    }
    let cache_name = w.cspec["cname" as keyof CacheMap] as string;
    let init_val = ctx.cache[cache_name as keyof CacheMap] as number;
    let cache_accessor = accessor_factory<number>(ctx, cache_name, init_val);
    ImGui.InputInt(cache_name, cache_accessor.access, ctx.step, ctx.step_fast, ctx.flags);
}


function render_label(ctx:NDContext, w: Widget): void { /**
    let cache_name = w.cspec["cname" as keyof CacheMap] as string;
    let init_val = ctx.cache[cache_name as keyof CacheMap] as string;
    let cache_accessor = accessor_factory<string>(ctx, cache_name, init_val);
    ImGui.LabelText(cache_name, cache_accessor.access); */
}


function render_separator(ctx:NDContext, w: Widget): void {
    ImGui.Separator();
}


function render_same_line(ctx:NDContext, w: Widget): void {
    ImGui.SameLine();
}


// main GUI footer
function render_footer(ctx:NDContext, w: Widget): void {
    ImGui.Text(`Application average ${(1000.0 / ctx.io!.Framerate).toFixed(3)} ms/frame (${ctx.io!.Framerate.toFixed(1)} FPS)`);
    ImGui.Checkbox("Memory Editor", (value = memory_editor.Open) => memory_editor.Open = value);
    ImGui.SameLine();
    ImGui.Checkbox("Demo Window", (value = show_demo_window) => show_demo_window = value);      // Edit bools storing our windows open/close state        
    if (memory_editor.Open)
        memory_editor.DrawWindow("Memory Editor", ImGui.bind.HEAP8.buffer);
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
       
    if (ctx.font) {
        ImGui.PushFont(ctx.font);
        ImGui.Text(`${ctx.font.GetDebugName()}`);
        if (ctx.font.FindGlyphNoFallback(0x5929)) {
            ImGui.Text(`U+5929: \u5929`);
        }
        ImGui.PopFont();
    }
}   


// Use node-fetch for HTTP GET as it's already in package-lock.json
// https://stackoverflow.com/questions/45748476/http-request-in-typescript
// Use websocket-ts for websock via "npm install websocket-ts"
// https://www.npmjs.com/package/websocket-ts
class NDContext {
    websock: WebSocket|null = null;
    layout: Widget[] = [];          // as served by /api/layout 
    stack: Widget[] = [];           // widgets currently rendering
    cache: Map<string, Cached<any>> = new Map();    // data from backend
    rfmap: Map<string, RenderFunc> = new Map<string, RenderFunc>([
            ["Home", render_home],
            ["InputInt", render_input_int],
            ["Label", render_label],
            ["Separator", render_separator],
            ["Footer", render_footer],
            ["SameLine", render_same_line],
        ]);      // render functions
    // consts
    update_interval: number = 50;
    init_interval: number = 1000;
    // fonts
    font: ImGui.Font|null = null;
    io: ImGui.IO|null = null;
    home: any|null = null;          // handle to Home layout
    // working vars so we can avoid the use of locals
    // in render funcs
    step: number = 1;
    step_fast: number = 1;
    flags: number = 0;
    
    
    constructor() {
        this.restore_defaults();
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
        let websock_url = "ws://" + window.location.hostname + ":8090/api/websock";
        let layout_url = "http://" + window.location.hostname + ":8090/api/layout";
        let cache_url = "http://" + window.location.hostname + ":8090/api/cache";        
        // Initialize WebSocket with buffering and 1s reconnection delay        
        this.websock = new WebSocket(websock_url);
        this.websock.onopen = this.on_open;
        this.websock.onclose = this.on_close;
        this.websock.onmessage = this.update;
        // HTTP GET to fetch layout description in JSON
        const layout_response = await window.fetch(layout_url);
        const layout_json = await layout_response.text();
        console.log('NDContext.init: ' + layout_json);
        this.layout = JSON.parse(layout_json) as Array<Widget>;
        // Pull cache init from server
        const cache_response = await window.fetch(cache_url);
        const cache_json = await cache_response.text();
        console.log('NDContext.init: ' + cache_json);
        let cache_init = await JSON.parse(cache_json);
        for (let ckey in cache_init) {
            // Extract the type and instance correct <T> for CacheAccess
            // https://stackoverflow.com/questions/35546421/how-to-get-a-variable-type-in-typescript
            let val = cache_init[ckey];
            let val_type = typeof val;  // JS type
            if (typeof val === "number") {
                this.cache.set(ckey, new Cached<number>(val));
            }
            else if (typeof val === "string") {
                this.cache.set(ckey, new Cached<string>(val));
            }
            else {
                this.cache.set(ckey, new Cached<any>(val));
            }
            console.log('NDContext.init: '+ckey+':'+val+':'+val_type);             
        }
        
        // Load font
        this.font = await this.load_font_ttf("../imgui/misc/fonts/Roboto-Medium.ttf", 16.0);
        ImGui.ASSERT(this.font !== null);

        // Finally, tee up the first element in layout to render: home
        this.stack.push(this.layout[0]);

        return 0;
    }
    
    
    on_open(ev: any): void {
        console.log("Websock connected");
    }
    
    on_close(ev: any): void {
        console.log("Websock closed");
    }
    
    update(ev: any): void {
        // let data_s:string = this.decoder.decode(value);
        console.log('NDContext.update: ' + ev.data);
        let data:any = JSON.parse(ev.data);
        // cache update code here...
    }
    
    render() {
        // fire the render methods of all the widgets on the stack
        // starting with the bottom of the stack: NDHome
        console.log('NDContext.render: child count ' + this.stack.length);
        for (let widget of this.stack) {
            dispatch_render(this, widget);
        } 
    }
    
    push(layout_element:any): void {
        this.stack.push(layout_element);
    }
    
    pop(): void {
        this.stack.pop();
    }
 
}

let _nd_ctx: NDContext = new NDContext();


async function _init(): Promise<void> {
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
        const output: HTMLElement = document.getElementById("output") || document.body;
        const canvas: HTMLCanvasElement = document.createElement("canvas");
        output.appendChild(canvas);
        canvas.tabIndex = 1;
        canvas.style.position = "absolute";
        canvas.style.left = "0px";
        canvas.style.right = "0px";
        canvas.style.top = "0px";
        canvas.style.bottom = "0px";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.userSelect = "none";
        ImGui_Impl.Init(canvas);
    } else {
        ImGui_Impl.Init(null);
    }
    
    if (typeof(window) !== "undefined") {
        // all the heavyweight init should be done here, before we kick
        // off the animation loop...
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
    if (!done && show_demo_window) {
        done = /*ImGui.*/ShowDemoWindow((value = show_demo_window) => show_demo_window = value);
    }

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
