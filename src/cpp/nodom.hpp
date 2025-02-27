#pragma once
#include <string>
#include <map>
#include <deque>
#include "json.hpp"
#include <pybind11/pybind11.h>
#include <filesystem>

#include <websocketpp/config/asio_no_tls_client.hpp>
#include <websocketpp/client.hpp>

// NoDOM emulation: debugging ND impls in TS/JS is tricky. Code compiled from C++ to clang .o
// is not available. So when we port to EM, we have to resort to printf debugging. Not good
// when we want to understand what the "correct" imgui behaviour should be. So here we have
// just enough impl to emulate ND server and client scaffolding that allows us to debug
// imgui logic. So we don't bother with HTTP, sockets etc as that just introduces more
// C++ code to maintain when we just want to focus on the impl that is opaque in the browser.
// JOS 2025-01-22

typedef websocketpp::client<websocketpp::config::asio_client> ws_client;

#define ND_MAX_COMBO_LIST 16
#define ND_WC_BUF_SZ 256

class NDServer {
public:
                    // Pass argv[1] to the ctor for the test data dir
                    NDServer(int argc, char** argv);
    virtual         ~NDServer();

                    // Emulating the NDContext.init() fetches from server
    std::string&    fetch(const std::string& key) { return json_map[key]; }
    nlohmann::json  notify_server_atomic(const std::string& caddr, int old_val, int new_val);
    nlohmann::json  notify_server_array(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val);

    bool            duck_app() { return is_duck_app; }


protected:
    bool load_json();
    bool init_python();
    bool fini_python();
    void compose_server_changes(pybind11::list& server_changes_p, nlohmann::json& server_changes_j);


private:
    nlohmann::json                      py_config;
    pybind11::object                    on_data_change_f;
    bool                                is_duck_app;
    char*                               exe;    // argv[0]
    wchar_t                             wc_buf[ND_WC_BUF_SZ];
    char*                               bb_json_path;
    std::string                         test_dir;
    std::string                         test_module_name;
    std::string                         test_name;
    std::map<std::string, std::string>  json_map;
};


class NDContext {
public:
    NDContext(NDServer& s);
    void render();                              // invoked by main loop

    void notify_server_atomic(const std::string& caddr, int old_val, int new_val);
    void notify_server_array(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val);
    void apply_server_changes(nlohmann::json& server_changes);

    bool duck_app() { return server.duck_app(); }

    void on_duck_event(ws_client* ws, websocketpp::connection_hdl h, nlohmann::json& duck_msg);

protected:
    void dispatch_render(nlohmann::json& w);        // w["rname"] resolve & invoke
    void action_dispatch(const std::string& action, const std::string& nd_event);
    void duck_dispatch(const std::string& nd_type, const std::string& sql, const std::string& qid, ws_client* ws);
    // Render funcs are members of NDContext, unlike in main.ts
    // Why? Separate standalone funcs like in main.ts cause too much
    // hassle with dispatch_render passing this and templating
    // defaulting to const. Wasted too much time experimenting
    // with std::bind, std::function etc. So the main.ts and
    // cpp will be different shapes, but hopefully with identical
    // decoupling profiles. JOS 2025-01-24
    void render_home(nlohmann::json& w);
    void render_input_int(nlohmann::json& w);
    void render_combo(nlohmann::json& w);
    void render_separator(nlohmann::json& w);
    void render_footer(nlohmann::json& w);
    void render_same_line(nlohmann::json& w);
    void render_date_picker(nlohmann::json& w);
    void render_text(nlohmann::json& w);
    void render_button(nlohmann::json& w);
    void render_duck_table_summary_modal(nlohmann::json& w);
    void render_duck_parquet_loading_modal(nlohmann::json& w);
    void render_table(nlohmann::json& w);

    void push(nlohmann::json& w);
    void pop(const std::string& rname = "");


private:
    // ref to "server process"; in reality it's just a Service class instance
    // with no event loop and synchornous dispatch across c++py boundary
    NDServer&                           server;
    
    nlohmann::json                      layout; // layout and data are fetched by 
    nlohmann::json                      data;   // sync c++py calls not HTTP gets
    std::deque<nlohmann::json>          stack;  // render stack

    // map layout render func names to the actual C++ impls
    std::unordered_map<std::string, std::function<void(nlohmann::json& w)>> rfmap;

    // top level layout widgets with widget_id eg modals are in pushables
    std::unordered_map<std::string, nlohmann::json> pushable;
    // main.ts:action_dispatch is called while rendering, and changes
    // the size of the render stack. JS will let us do that in the root
    // render() method. But in C++ we use an STL iterator in the root render
    // method, and that segfaults. So in C++ we have pending pushes done
    // outside the render stack walk. JOS 2025-01-31
    std::deque<nlohmann::json> pending_pushes;
    std::deque<std::string> pending_pops;
    bool    show_id_stack = false;

    // colours: https://www.w3schools.com/colors/colors_picker.asp
    ImColor red;    // ImGui.COL32(255, 51, 0);
    ImColor green;  // ImGui.COL32(102, 153, 0);
    ImColor amber;  // ImGui.COL32(255, 153, 0);
    ImColor db_status_color;

    // default value for invoking std::find on nlohmann JSON iterators
    std::string null_value = "null_value";

    bool    is_rendering;
};
