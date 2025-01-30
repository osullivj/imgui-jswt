#pragma once
#include <string>
#include <map>
#include <deque>
#include "json.hpp"
#include <pybind11/pybind11.h>
#include <filesystem>
// NoDOM emulation: debugging ND impls in TS/JS is tricky. Code compiled from C++ to clang .o
// is not available. So when we port to EM, we have to resort to printf debugging. Not good
// when we want to understand what the "correct" imgui behaviour should be. So here we have
// just enough impl to emulate ND server and client scaffolding that allows us to debug
// imgui logic. So we don't bother with HTTP, sockets etc as that just introduces more
// C++ code to maintain when we just want to focus on the impl that is opaque in the browser.
// JOS 2025-01-22

#define ND_MAX_COMBO_LIST 16
#define ND_WC_BUF_SZ 256

class NDServer {
public:
    // Pass argv[1] to the ctor for the test data dir
    NDServer(int argc, char** argv);
    virtual ~NDServer();
    // Emulating the NDContext.init() fetches from server
    std::string&    fetch(const std::string& key) { return json_map[key]; }
    nlohmann::json  notify_server_atomic(const std::string& caddr, int old_val, int new_val);
    nlohmann::json  notify_server_array(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val);


protected:
    bool load_json();
    bool init_python();
    bool fini_python();
    void compose_server_changes(pybind11::list& server_changes_p, nlohmann::json& server_changes_j);


private:
    nlohmann::json                      py_config;
    pybind11::object                    on_data_change_f;
    char*                               exe;    // argv[0]
    wchar_t                             wc_buf[ND_WC_BUF_SZ];
    char*                               bb_json_path;
    std::string                         test_dir;
    std::string                         test_module_name;
    std::string                         src_py_path;
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


protected:
    void dispatch_render(nlohmann::json& w);    // w["rname"] resolve & invoke

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


private:
    NDServer&                           server;
    nlohmann::json                      layout;
    nlohmann::json                      data;
    std::deque<nlohmann::json>          stack;
    std::unordered_map<std::string, std::function<void(nlohmann::json& w)>> rfmap;
    // std::map<std::string, const NDRenderFunc> rfmap;
    // NDRenderHome _render_home;
};
