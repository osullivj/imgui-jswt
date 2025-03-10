// Dear ImGui: standalone example application for GLFW + OpenGL 3, using programmable pipeline
// (GLFW is a cross-platform general purpose library for handling windows, inputs, OpenGL/Vulkan/Metal graphics context creation, etc.)
// If you are new to Dear ImGui, read documentation from the docs/ folder + read the top of imgui.cpp.
// Read online: https://github.com/ocornut/imgui/tree/master/docs
// websock hdrs
#include <iostream>
#include <boost/asio/io_service.hpp>
#include <boost/asio/deadline_timer.hpp>
#include <boost/function.hpp>
#include <boost/bind.hpp>
#include <boost/date_time/posix_time/posix_time.hpp>

#include <websocketpp/config/asio_no_tls_client.hpp>
#include <websocketpp/client.hpp>

// imgui hdrs
#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include <stdio.h>
#if defined(IMGUI_IMPL_OPENGL_ES2)
#include <GLES2/gl2.h>
#endif
#include <GLFW/glfw3.h> // Will drag system OpenGL headers

#include "nodom.hpp"

// [Win32] Our example includes a copy of glfw3.lib pre-compiled with VS2010 to maximize ease of testing and compatibility with old VS compilers.
// To link with VS2010-era libraries, VS2015+ requires linking with legacy_stdio_definitions.lib, which we do using this pragma.
// Your own project should not be affected, as you are likely to link with a newer binary of GLFW that is adequate for your version of Visual Studio.
#if defined(_MSC_VER) && (_MSC_VER >= 1900) && !defined(IMGUI_DISABLE_WIN32_FUNCTIONS)
#pragma comment(lib, "legacy_stdio_definitions")
#endif

static void glfw_error_callback(int error, const char* description)
{
    fprintf(stderr, "Glfw Error %d: %s\n", error, description);
}


static bool show_demo_window = true;
static ImVec4 clear_color = ImVec4(0.45f, 0.55f, 0.60f, 1.00f);

// int im_main(int argc, char** argv)
GLFWwindow* im_start()
{
    // Setup window
    glfwSetErrorCallback(glfw_error_callback);
    if (!glfwInit())
        return nullptr;

    // Decide GL+GLSL versions
#if defined(IMGUI_IMPL_OPENGL_ES2)
    // GL ES 2.0 + GLSL 100
    const char* glsl_version = "#version 100";
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
    glfwWindowHint(GLFW_CLIENT_API, GLFW_OPENGL_ES_API);
#elif defined(__APPLE__)
    // GL 3.2 + GLSL 150
    const char* glsl_version = "#version 150";
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 2);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);  // 3.2+ only
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);            // Required on Mac
#else
    // GL 3.0 + GLSL 130
    const char* glsl_version = "#version 130";
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 0);
    //glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);  // 3.2+ only
    //glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);            // 3.0+ only
#endif

    // Create window with graphics context
    GLFWwindow* window = glfwCreateWindow(1280, 720, "Nodom Breadboard", NULL, NULL);
    if (window == nullptr)
        return window;
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1); // Enable vsync

    // Setup Dear ImGui context
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO(); (void)io;
    //io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;     // Enable Keyboard Controls
    //io.ConfigFlags |= ImGuiConfigFlags_NavEnableGamepad;      // Enable Gamepad Controls

    // Setup Dear ImGui style
    ImGui::StyleColorsDark();
    //ImGui::StyleColorsClassic();

    // Setup Platform/Renderer backends
    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init(glsl_version);

    // Load Fonts
    // - If no fonts are loaded, dear imgui will use the default font. You can also load multiple fonts and use ImGui::PushFont()/PopFont() to select them.
    // - AddFontFromFileTTF() will return the ImFont* so you can store it if you need to select the font among multiple.
    // - If the file cannot be loaded, the function will return NULL. Please handle those errors in your application (e.g. use an assertion, or display an error and quit).
    // - The fonts will be rasterized at a given size (w/ oversampling) and stored into a texture when calling ImFontAtlas::Build()/GetTexDataAsXXXX(), which ImGui_ImplXXXX_NewFrame below will call.
    // - Read 'docs/FONTS.md' for more instructions and details.
    // - Remember that in C/C++ if you want to include a backslash \ in a string literal you need to write a double backslash \\ !
    //io.Fonts->AddFontDefault();
    //io.Fonts->AddFontFromFileTTF("../../misc/fonts/Roboto-Medium.ttf", 16.0f);
    //io.Fonts->AddFontFromFileTTF("../../misc/fonts/Cousine-Regular.ttf", 15.0f);
    //io.Fonts->AddFontFromFileTTF("../../misc/fonts/DroidSans.ttf", 16.0f);
    //io.Fonts->AddFontFromFileTTF("../../misc/fonts/ProggyTiny.ttf", 10.0f);
    //ImFont* font = io.Fonts->AddFontFromFileTTF("c:\\Windows\\Fonts\\ArialUni.ttf", 18.0f, NULL, io.Fonts->GetGlyphRangesJapanese());
    //IM_ASSERT(font != NULL);

    // Our state
    return window;
}



int im_render(GLFWwindow* window, NDContext& ctx)
{
    if (!glfwWindowShouldClose(window)) {
        // Poll and handle events (inputs, window resize, etc.)
        // You can read the io.WantCaptureMouse, io.WantCaptureKeyboard flags to tell if dear imgui wants to use your inputs.
        // - When io.WantCaptureMouse is true, do not dispatch mouse input data to your main application.
        // - When io.WantCaptureKeyboard is true, do not dispatch keyboard input data to your main application.
        // Generally you may always pass all inputs to dear imgui, and hide them from your application based on those two flags.
        glfwPollEvents();

        // Start the Dear ImGui frame
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        // 1. Show the big demo window (Most of the sample code is in ImGui::ShowDemoWindow()! You can browse its code to learn more about Dear ImGui!).
        if (show_demo_window)
            ImGui::ShowDemoWindow(&show_demo_window);

        ctx.render();

        // Rendering
        ImGui::Render();
        int display_w, display_h;
        glfwGetFramebufferSize(window, &display_w, &display_h);
        glViewport(0, 0, display_w, display_h);
        glClearColor(clear_color.x * clear_color.w, clear_color.y * clear_color.w, clear_color.z * clear_color.w, clear_color.w);
        glClear(GL_COLOR_BUFFER_BIT);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        glfwSwapBuffers(window);
        return 1;
    }
    return 0;
}

void im_end(GLFWwindow* window)
{
    // Cleanup
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    glfwDestroyWindow(window);
    glfwTerminate();
}


typedef websocketpp::client<websocketpp::config::asio_client> ws_client;
typedef websocketpp::connection_hdl ws_handle;
typedef websocketpp::lib::error_code    ws_error_code;
typedef websocketpp::config::asio_client::message_type::ptr message_ptr;
typedef boost::asio::deadline_timer     asio_timer;

using websocketpp::lib::placeholders::_1;
using websocketpp::lib::placeholders::_2;
using websocketpp::lib::bind;



class NDWebSockClient {
public:
    NDWebSockClient(const std::string& url, NDContext& c) : uri(url), ctx(c), window(im_start()) {
        client.set_access_channels(websocketpp::log::alevel::all);
        client.clear_access_channels(websocketpp::log::alevel::frame_payload);
        client.init_asio();
        client.set_message_handler(bind(&NDWebSockClient::on_message, this, &client, ::_1, ::_2));
        client.set_open_handler(bind(&NDWebSockClient::on_open, this, &client, ::_1));
        client.set_close_handler(bind(&NDWebSockClient::on_close, this, &client, ::_1));
        client.set_fail_handler(bind(&NDWebSockClient::on_fail, this, &client, ::_1));
    }

    void run() {
        if (ctx.duck_app()) {
            ctx.register_ws_callback(bind(&NDWebSockClient::send, this, ::_1));
            error_code.clear();
            ws_client::connection_ptr con = client.get_connection(uri, error_code);
            if (error_code) {
                std::cerr << "NDWebSockClient: could not create connection because: "
                                                    << error_code.message() << std::endl;
            }
            else {
                // TODO: possible discard the websock conn
                // client.connect(con);
            }
        }
        set_timer();    // latest possible timer start
        client.run();   // this method just calls io_service.run()
    }

    void send(const std::string& payload) {
        error_code.clear();
        client.send(handle, payload, websocketpp::frame::opcode::TEXT, error_code);
        if (error_code) {
            std::cerr << "NDWebSockClient::send: failed with " << error_code << std::endl;
        }
    }

protected:
    void set_timer() {
        asio_timer timer(client.get_io_service());
        timer.expires_from_now(boost::posix_time::millisec(16));
        timer.async_wait(boost::bind(&NDWebSockClient::on_timeout, this, ::_1));
    }

    void on_timeout(const boost::system::error_code& e) {
        // if im_render returns false someone has closed the app via GUI
        if (!im_render(window, ctx)) {
            im_end(window);                 // imgui finalisation
            ctx.set_done(true);             // py thread loop exit
            client.get_io_service().stop(); // asio finalisation
        }
        else {
            set_timer();
            // are there any responses from the python side?
            while (!python_responses.empty()) {
                python_responses.pop();
                std::cerr << "NDWebSockClient::on_timeout: python_responses not empty!" << std::endl;
            }
            ctx.get_server_responses(python_responses);
            ctx.dispatch_server_responses(python_responses);
        }
    }

    void on_message(ws_client* c, ws_handle h, message_ptr msg_ptr) {
        std::string payload(msg_ptr->get_payload());
        std::cout << "NDWebSockClient::on_message: hdl( " << h.lock().get()
            << ") msg: " << payload << std::endl;

        nlohmann::json msg_json = nlohmann::json::parse(payload);
        ctx.on_duck_event(/*c, h, */ msg_json);
    }


    void on_open(ws_client* c, ws_handle h) {
        std::cout << "NDWebSockClient::on_open: hdl:" << h.lock().get() << std::endl;
        handle = h;
    }

    void on_close(ws_client* c, ws_handle h) {
        std::cout << "NDWebSockClient::on_close: hdl: " << h.lock().get() << std::endl;
    }

    void on_fail(ws_client* c, ws_handle h) {
        std::cout << "NDWebSockClient::on_fail: hdl: " << h.lock().get() << std::endl;
    }

private:
    std::string     uri;
    ws_client       client;
    ws_handle       handle;
    ws_error_code   error_code;
    NDContext&      ctx;
    GLFWwindow*     window;
    std::queue<nlohmann::json>  python_responses;
};


int main(int argc, char* argv[]) {
    std::string uri = "ws://localhost:8892/api/websock";
    NDServer server(argc, argv);
    NDContext ctx(server);
    try {
        NDWebSockClient ws_client(uri, ctx);
        ws_client.run();
    }
    catch (websocketpp::exception const& e) {
        std::cout << e.what() << std::endl;
    }
}

