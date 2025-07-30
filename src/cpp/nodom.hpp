#pragma once
#include <string>
#include <map>
#include <deque>
#include "json.hpp"
#include <pybind11/pybind11.h>
#include <filesystem>
#include <functional>
#include <boost/atomic.hpp>
#include <boost/thread.hpp>
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
public:             // All public methods exec on the cpp thread

                    NDServer(int argc, char** argv);
    virtual         ~NDServer();

    std::string&    fetch(const std::string& key) { return json_map[key]; }

    bool            duck_app() { return is_duck_app; }

    // cpp thread
    void            notify_server(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val);
    void            duck_dispatch(nlohmann::json& db_request);
    void            get_server_responses(std::queue<nlohmann::json>& responses);
    void            set_done(bool d) { done = d; }
    nlohmann::json  get_breadboard_config() { return bb_config; }

protected:
    // cpp thread
    bool load_json();

    // py thread
    bool init_python();
    bool fini_python();
    void python_thread();
    void marshall_server_responses(pybind11::list& server_changes_p, nlohmann::json& server_changes_j,
                                    const std::string& type_filter);

private:
    nlohmann::json                      bb_config;
    pybind11::object                    on_data_change_f;
    pybind11::object                    duck_request_f;
    bool                                is_duck_app;
    char*                               exe;    // argv[0]
    wchar_t                             wc_buf[ND_WC_BUF_SZ];
    char*                               bb_json_path;

    // these three test config strings are written once at startup
    // time in the cpp thread, and read from the py thread
    std::string                         test_dir;
    std::string                         test_module_name;
    std::string                         test_name;

    std::map<std::string, std::string>  json_map;

    // queues, mutexes and condition for managing C++ to python work
    std::queue<nlohmann::json>          to_python;
    std::queue<nlohmann::json>          from_python;
    boost::mutex                        to_mutex;
    boost::mutex                        from_mutex;
    boost::condition_variable           to_cond;
    boost::condition_variable           from_cond;
    boost::atomic<bool>                 done;
    boost::thread                       py_thread;
};

typedef std::function<void(const std::string&)> ws_sender;

class NDContext {
public:
    NDContext(NDServer& s);
    void render();                              // invoked by main loop

    void notify_server(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val);
    void dispatch_server_responses(std::queue<nlohmann::json>& responses);
    void get_server_responses(std::queue<nlohmann::json>& responses);

    bool duck_app() { return server.duck_app(); }
    void set_done(bool d) { server.set_done(d); }

    void on_duck_event(nlohmann::json& duck_msg);

    nlohmann::json  get_breadboard_config() { return server.get_breadboard_config(); }

    void register_ws_callback(ws_sender send) { ws_send = send; }

    void register_font(const std::string& name, ImFont* f) { font_map[name] = f; }

protected:
    void dispatch_render(nlohmann::json& w);        // w["rname"] resolve & invoke
    void action_dispatch(const std::string& action, const std::string& nd_event);
    void duck_dispatch(const std::string& nd_type, const std::string& sql, const std::string& qid);
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

    void push_widget(nlohmann::json& w);
    void pop_widget(const std::string& rname = "");

    void push_font(nlohmann::json& w);
    void pop_font(nlohmann::json& w);
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

    std::map<std::string, ImFont*>  font_map;

    // default value for invoking std::find on nlohmann JSON iterators
    std::string null_value = "null_value";

    // ref to NDWebSockClient::send
    ws_sender ws_send;
};
