import * as ImGui from "imgui-js";
import * as ImGui_Impl from "./imgui_impl.js";
import { ShowDemoWindow } from "./imgui_demo.js";
import { MemoryEditor } from "./imgui_memory_editor.js";

let font: ImGui.Font | null = null;

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

async function AddFontFromFileTTF(url: string, size_pixels: number, font_cfg: ImGui.FontConfig | null = null, glyph_ranges: number | null = null): Promise<ImGui.Font> {
    font_cfg = font_cfg || new ImGui.FontConfig();
    font_cfg.Name = font_cfg.Name || `${url.split(/[\\\/]/).pop()}, ${size_pixels.toFixed(0)}px`;
    return ImGui.GetIO().Fonts.AddFontFromMemoryTTF(await LoadArrayBuffer(url), size_pixels, font_cfg, glyph_ranges);
}

class H3Context {
    web_trans: any;     // no definitive WebTransport IDL!
    dgram_reader: any;
    dgram_writer: any;    
    start_ts: Date;
    end_ts: Date;
    inst_map: Map<string, number>;
    
    constructor() {
        this.start_ts = new Date();
        this.end_ts = new Date();
        this.inst_map = new Map<string,number>();
    }
}

let _h3ctx: H3Context = new H3Context();

function _h3updateContext(data: any) {
    console.log('_h3updateContext: '+ data);
}

// Reads datagrams from web_trans into the event log until EOF is reached.
async function _h3readDatagrams() {
    /*
  try {
    var reader = _h3ctx.web_trans.datagrams.readable.getReader();
    console.log('Datagram reader ready.');
  } catch (e) {
    console.log('Receiving datagrams not supported: ' + e, 'error');
    return;
  } */
  var decoder = new TextDecoder('utf-8');
  try {
    while (true) {
      const { value, done } = await _h3ctx.dgram_reader.read();
      if (done) {
        console.log('Done reading datagrams!');
        return;
      }
      var data = decoder.decode(value);
      console.log('Datagram received: ' + data);
      _h3updateContext(data);
    }
  } catch (e) {
    console.log('Error while reading datagrams: ' + e, 'error');
  }
}

async function h3readDatagrams(value: any, done: boolean) {
  if (done) {
    console.log('Done reading datagrams!');
    return;
  }    
  var decoder = new TextDecoder('utf-8');
  try {
      var data = decoder.decode(value);
      console.log('Datagram received: ' + data);
      _h3updateContext(data);
  } catch (e) {
    console.log('Error while reading datagrams: ' + e, 'error');
  }
}

async function _h3connect() {
  const url = "https://localhost:4433/"; // document.getElementById('url').value;
  try {
    _h3ctx.web_trans = new WebTransport(url);
    console.log("Initiating H3Connection...");
  } catch (e) {
    console.log("Failed to create H3Connection object. " + e);
    return;
  }

  try {
    await _h3ctx.web_trans.ready;
    console.log("H3Connection ready.");
  } catch (e) {
    console.log("H3Connection failed. " + e);
    return;
  }

  _h3ctx.web_trans.closed
      .then(() => {
        console.log("H3Connection closed normally.");
      })
      .catch(() => {
        console.log("H3Connection closed abruptly.");
      });
       
  var streamNumber = 1;
  try {
    _h3ctx.dgram_writer = _h3ctx.web_trans.datagrams.writable.getWriter();
    console.log('Datagram writer ready.');
  } catch (e) {
    console.log('Sending datagrams not supported: ' + e, 'error');
    return;
  }
  
  try {
    _h3ctx.dgram_reader = _h3ctx.web_trans.datagrams.readable.getReader();
    // _h3ctx.dgram_reader.read().then(_h3readDatagrams);
    console.log('Datagram reader ready.');    
  } catch (e) {
    console.log("Datagram reader init failed: " + e);
    return;
  }
  
}

async function _init(): Promise<void> {
    const EMSCRIPTEN_VERSION = `${ImGui.bind.__EMSCRIPTEN_major__}.${ImGui.bind.__EMSCRIPTEN_minor__}.${ImGui.bind.__EMSCRIPTEN_tiny__}`;
    console.log("Emscripten Version", EMSCRIPTEN_VERSION);

    console.log("Total allocated space (uordblks) @ _init:", ImGui.bind.mallinfo().uordblks);

    // Setup Dear ImGui context
    ImGui.CHECKVERSION();
    ImGui.CreateContext();
    const io: ImGui.IO = ImGui.GetIO();
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
    io.Fonts.AddFontDefault();
    font = await AddFontFromFileTTF("../imgui/misc/fonts/Roboto-Medium.ttf", 16.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/Cousine-Regular.ttf", 15.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/DroidSans.ttf", 16.0);
    // font = await AddFontFromFileTTF("../imgui/misc/fonts/ProggyTiny.ttf", 10.0);
    // font = await AddFontFromFileTTF("c:\\Windows\\Fonts\\ArialUni.ttf", 18.0, null, io.Fonts.GetGlyphRangesJapanese());
    // font = await AddFontFromFileTTF("https://raw.githubusercontent.com/googlei18n/noto-cjk/master/NotoSansJP-Regular.otf", 18.0, null, io.Fonts.GetGlyphRangesJapanese());
    ImGui.ASSERT(font !== null);

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
        window.requestAnimationFrame(_loop);
    }
    
    _h3connect();
}

// Main loop
function _loop(time: number): void {
    // Poll and handle events (inputs, window resize, etc.)
    // You can read the io.WantCaptureMouse, io.WantCaptureKeyboard flags to tell if dear imgui wants to use your inputs.
    // - When io.WantCaptureMouse is true, do not dispatch mouse input data to your main application.
    // - When io.WantCaptureKeyboard is true, do not dispatch keyboard input data to your main application.
    // Generally you may always pass all inputs to dear imgui, and hide them from your application based on those two flags.
    
    // Handle any datagrams that have arrived since the last render...
    // yes, this is an async func, and we're invoking from a sync func.
    // In this case that's OK, as the the func has no return val to await
    _h3readDatagrams();
    
    // Start the Dear ImGui frame
    ImGui_Impl.NewFrame(time);
    ImGui.NewFrame();

    // 1. Show the big demo window (Most of the sample code is in ImGui::ShowDemoWindow()! You can browse its code to learn more about Dear ImGui!).
    if (!done && show_demo_window) {
        done = /*ImGui.*/ShowDemoWindow((value = show_demo_window) => show_demo_window = value);
    }

    // 2. Show a simple window that we create ourselves. We use a Begin/End pair to created a named window.
    {
        // static float f = 0.0f;
        // static int counter = 0;
        ImGui.Begin("HFGUI");
        
        // inst select drop down
        
        // start end datetime grid
        
        // depth grid

        // main GUI footer
        ImGui.Text(`Application average ${(1000.0 / ImGui.GetIO().Framerate).toFixed(3)} ms/frame (${ImGui.GetIO().Framerate.toFixed(1)} FPS)`);
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
        
        if (font) {
            ImGui.PushFont(font);
            ImGui.Text(`${font.GetDebugName()}`);
            if (font.FindGlyphNoFallback(0x5929)) {
                ImGui.Text(`U+5929: \u5929`);
            }
            ImGui.PopFont();
        }

        ImGui.End();
    }


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

    const ctx: CanvasRenderingContext2D | null = ImGui_Impl.ctx;
    if (ctx) {
        ctx.fillStyle = `rgba(${clear_color.x * 0xff}, ${clear_color.y * 0xff}, ${clear_color.z * 0xff}, ${clear_color.w})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
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
