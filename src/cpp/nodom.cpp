#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include "ImGuiDatePicker.hpp"
#include <stdio.h>
// STL
#include <string>
#include <list>
#include <fstream>
#include <iostream>
#include <sstream>
#include <functional>
#include <vector>
#include <filesystem>
#include <algorithm>
// nlohmann/json/single_include/nlohmann/json.hpp
// pybind11
#include <pybind11/embed.h>
#include "pybind11_json.hpp"
#include "nodom.hpp"

// Python consts
static char* on_data_change_cs("on_data_change");
static char* is_duck_app_cs("is_duck_app");
static char* data_change_cs("DataChange");
static std::string data_change_s(data_change_cs);
static char* data_change_confirmed_cs("DataChangeConfirmed");
static char* new_value_cs("new_value");
static char* old_value_cs("old_value");
static char* cache_key_cs("cache_key");
static char* nd_type_cs("nd_type");
static char* __nodom__cs("__nodom__");
static char* sys_cs("sys");
static char* path_cs("path");
static char* service_cs("service");
static char* breadboard_cs("breadboard");


NDServer::NDServer(int argc, char** argv)
    :is_duck_app(false)
{
    std::string usage("breadboard <breadboard_config_json_path> <test_dir>");
    if (argc < 3) {
        printf("breadboard <breadboard_config_json_path> <test_dir>");
        exit(1);
    }
    exe = argv[0];
    bb_json_path = argv[1];
    test_dir = argv[2];

    if (!std::filesystem::exists(bb_json_path)) {
        std::cerr << usage << std::endl << "Cannot load breadboard config json from " << bb_json_path << std::endl;
        exit(1);
    }
    try {
        // breadboard.json specifies the base paths for the embedded py
        std::stringstream json_buffer;
        std::ifstream in_file_stream(bb_json_path);
        json_buffer << in_file_stream.rdbuf();
        py_config = nlohmann::json::parse(json_buffer);
    }
    catch (...) {
        printf("cannot load breadboard.json");
        exit(1);
    }

    // figure out the module from test name
    std::filesystem::path test_path(test_dir);
    test_module_name = test_path.stem().string();

    if (!init_python()) exit(1);

    load_json();
}

NDServer::~NDServer() {
    fini_python();
}

bool NDServer::init_python()
{
    try {
        // See "Custom PyConfig"
        // https://raw.githubusercontent.com/pybind/pybind11/refs/heads/master/tests/test_embed/test_interpreter.cpp
        PyConfig config;
        PyConfig_InitPythonConfig(&config);

        // should set exe name to breadboard.exe
        std::mbstowcs(wc_buf, exe, ND_WC_BUF_SZ);
        PyConfig_SetString(&config, &config.executable, wc_buf);

        // now get base_prefix (orig py install dir) and prefix (venv) from breadboard.json
        std::string base_prefix = py_config["base_prefix"];
        std::string prefix = py_config["prefix"];
        std::mbstowcs(wc_buf, base_prefix.c_str(), ND_WC_BUF_SZ);
        PyConfig_SetString(&config, &config.base_prefix, wc_buf);
        std::mbstowcs(wc_buf, prefix.c_str(), ND_WC_BUF_SZ);
        PyConfig_SetString(&config, &config.prefix, wc_buf);

        // Start Python runtime
        Py_InitializeFromConfig(&config);
        // pybind11::initialize_interpreter();

        // as a sanity check, import sys and print sys.path
        auto sys_module = pybind11::module_::import(sys_cs);
        auto path_p = sys_module.attr(path_cs);
        pybind11::print("sys.path: ", path_p);

        // src/py is not in sys.path, so how do we import?
        // see nodom.pth in site-packages
        auto test_module = pybind11::module_::import(test_module_name.c_str());
        pybind11::object service = test_module.attr(service_cs);
        on_data_change_f = service.attr(on_data_change_cs);
        is_duck_app = pybind11::bool_(service.attr(is_duck_app_cs));
    }
    catch (pybind11::error_already_set& ex) {
        std::cerr << ex.what() << std::endl;
        return false;
    }
    return true;
}


bool NDServer::fini_python()
{
    // TODO: debug refcount errors. Is it happening because we're mixing
    // Py_InitializeFromConfig with pybind11 ?
    // pybind11::finalize_interpreter();
    return true;
}

bool NDServer::load_json()
{
    // bool rv = true;
    std::list<std::string> json_files = { "layout", "data" };
    for (auto jf : json_files) {
        std::filesystem::path jpath(test_dir);
        std::stringstream file_name_buffer;
        file_name_buffer << jf << ".json";
        jpath.append(file_name_buffer.str());
        std::cout << "load_json: " << jpath << std::endl;
        std::stringstream json_buffer;
        std::ifstream in_file_stream(jpath);
        json_buffer << in_file_stream.rdbuf();
        json_map[jf] = json_buffer.str();
    }
    return true;
}


void NDServer::compose_server_changes(pybind11::list& server_changes_p, nlohmann::json& server_changes_j)
{
    for (int i = 0; i < server_changes_p.size(); i++) {
        pybind11::dict change_p = server_changes_p[i];
        std::string nd_type = pyjson::to_json(change_p[nd_type_cs]);
        if (nd_type == data_change_cs) {
            nlohmann::json change_j;
            change_j[nd_type_cs] = pybind11::str(data_change_cs);
            change_j[cache_key_cs] = pyjson::to_json(change_p[cache_key_cs]);
            change_j[new_value_cs] = pyjson::to_json(change_p[new_value_cs]);
            change_j[old_value_cs] = pyjson::to_json(change_p[old_value_cs]);
            server_changes_j.push_back(change_j);
        }
    }
}

nlohmann::json NDServer::notify_server_atomic(const std::string& caddr, int old_val, int new_val)
{
    std::cout << "cpp: notify_server_atomic: " << caddr << ", old: " << old_val << ", new: " << new_val << std::endl;
    // the client has set data[caddr]=new_val, so let the server side python know so
    // it can react with its own changes
    pybind11::dict nd_message;
    // NDAPIApp.on_ws_message() invokes on_data_change() to apply the changes to the
    // server side cache. Note the explicit casts on RHS like pybind11::str()
    // V important for eg caddr, which is probably from a json obj. We do not
    // want move semantics kicking in then...
    nd_message[nd_type_cs] = pybind11::str(data_change_cs);
    nd_message[cache_key_cs] = pybind11::str(caddr.c_str());
    nd_message[new_value_cs] = new_val;
    nd_message[old_value_cs] = old_val;

    std::cout << "cpp: notify_server_atomic: " << nd_type_cs << ":" << data_change_cs << std::endl;
    std::cout << "cpp: notify_server_atomic: " << cache_key_cs << ":" << caddr << std::endl;
    std::cout << "cpp: notify_server_atomic: " << new_value_cs << ":" << new_val << std::endl;
    std::cout << "cpp: notify_server_atomic: " << old_value_cs << ":" << old_val << std::endl;

    // TODO: debug Python mem issue: suspect that the std::string cache_key is holding
    // a Python char* which gets copied into the json array. apply_server_changes() is
    // invoked by our caller
    pybind11::list server_changes_p = on_data_change_f(breadboard_cs, nd_message);
    nlohmann::json server_changes_j = nlohmann::json::array();
    compose_server_changes(server_changes_p, server_changes_j);
    return server_changes_j;
}


void json_atomic_array_to_python_list(nlohmann::json& atomic_array_j, pybind11::list& list_p)
{
    for (auto it : atomic_array_j) {
        list_p.append(pyjson::from_json(it));
    }
}


nlohmann::json NDServer::notify_server_array(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val)
{
    std::cout << "cpp: notify_server_array: " << caddr << ", old: " << old_val << ", new: " << new_val << std::endl;
    // the client has set data[caddr]=new_val, so let the server side python know so
    // it can react with its own changes
    pybind11::dict nd_message;
    // NDAPIApp.on_ws_message() invokes on_data_change() to apply the changes to the
    // server side cache
    nd_message[nd_type_cs] = pybind11::str(data_change_cs);
    nd_message[cache_key_cs] = pybind11::str(caddr.c_str());
    pybind11::list array_new_p, array_old_p;
    json_atomic_array_to_python_list(new_val, array_new_p);
    json_atomic_array_to_python_list(old_val, array_old_p);
    nd_message[new_value_cs] = array_new_p;
    nd_message[old_value_cs] = array_old_p;

    std::cout << "cpp: notify_server_array: " << nd_type_cs << ":" << data_change_cs << std::endl;
    std::cout << "cpp: notify_server_array: " << cache_key_cs << ":" << caddr << std::endl;
    std::cout << "cpp: notify_server_array: " << new_value_cs << ":" << new_val << std::endl;
    std::cout << "cpp: notify_server_array: " << old_value_cs << ":" << old_val << std::endl;

    try {
        pybind11::list server_changes_p = on_data_change_f(breadboard_cs, nd_message);
        nlohmann::json server_changes_j = nlohmann::json::array();
        compose_server_changes(server_changes_p, server_changes_j);
        return server_changes_j;
    }
    catch (pybind11::error_already_set& ex) {
        std::cerr << "cpp: notify_server_atomic_array: " << ex.what() << std::endl;

    }
    catch (pybind11::cast_error& ex) {
        std::cerr << "cpp: notify_server_atomic_array: " << ex.what() << std::endl;
    }
    return nlohmann::json::array();
}


NDContext::NDContext(NDServer& s)
    :server(s), red(255, 51, 0), green(102, 153, 0), amber(255, 153, 0),
    is_rendering(false)
{
    // init status is not connected
    db_status_color = red;

    // emulate the main.ts NDContext fetch from server side
    std::string layout_s = server.fetch("layout");
    layout = nlohmann::json::parse(layout_s);
    data = nlohmann::json::parse(server.fetch("data"));

    // layout is a list of widgets; and all may have children
    // however, not all widgets are children. For instance modals
    // like parquet_loading_modal have to be explicitly pushed
    // on to the render stack by an event. JOS 2025-01-31
    for (nlohmann::json::iterator it = layout.begin(); it != layout.end(); ++it) {
        std::cout << "NDcontext.ctor: pushable: " << *it << std::endl;
        std::string widget_id = it->value("widget_id", "");
        if (!widget_id.empty()) {
            std::cout << "NDcontext.ctor: pushable: " << widget_id << ":" << *it << std::endl;
            pushable[widget_id] = *it;
        }
    }

    rfmap.emplace(std::string("Home"), [this](nlohmann::json& w){ render_home(w); });
    rfmap.emplace(std::string("InputInt"), [this](nlohmann::json& w) { render_input_int(w); });
    rfmap.emplace(std::string("Combo"), [this](nlohmann::json& w) { render_combo(w); });
    rfmap.emplace(std::string("Separator"), [this](nlohmann::json& w) { render_separator(w); });
    rfmap.emplace(std::string("Footer"), [this](nlohmann::json& w) { render_footer(w); });
    rfmap.emplace(std::string("SameLine"), [this](nlohmann::json& w) { render_same_line(w); });
    rfmap.emplace(std::string("DatePicker"), [this](nlohmann::json& w) { render_date_picker(w); });
    rfmap.emplace(std::string("Text"), [this](nlohmann::json& w) { render_text(w); });
    rfmap.emplace(std::string("Button"), [this](nlohmann::json& w) { render_button(w); });
    rfmap.emplace(std::string("DuckTableSummaryModal"), [this](nlohmann::json& w) { render_duck_table_summary_modal(w); });
    rfmap.emplace(std::string("DuckParquetLoadingModal"), [this](nlohmann::json& w) { render_duck_parquet_loading_modal(w); });
    rfmap.emplace(std::string("Table"), [this](nlohmann::json& w) { render_table(w); });

    // Home on the render stack
    stack.push_back(layout[0]);
}


void NDContext::apply_server_changes(nlohmann::json& server_changes)
{
    // server_changes will be a list of json obj copied out of a pybind11
    // list of py dicts. So use C++11 auto range...
    for (auto change : server_changes) {
        // polymorphic as types are hidden inside change
        data[change[cache_key_cs]] = change[new_value_cs];
    }
}


void NDContext::notify_server_atomic(const std::string& caddr, int old_val, int new_val)
{
    // server.notify_server_atomic() will use invoke python, and return a json list
    // with refs to python mem embedded. So we hold the GIL here...
    pybind11::gil_scoped_acquire acquire;
    nlohmann::json server_changes = server.notify_server_atomic(caddr, old_val, new_val);
    apply_server_changes(server_changes);
}


void NDContext::notify_server_array(const std::string& caddr, nlohmann::json& old_val, nlohmann::json& new_val)
{
    // server.notify_server_atomic() will use invoke python, and return a json list
    // with refs to python mem embedded. So we hold the GIL here...
    pybind11::gil_scoped_acquire acquire;
    nlohmann::json server_changes = server.notify_server_array(caddr, old_val, new_val);
    apply_server_changes(server_changes);
}

void NDContext::on_duck_event(ws_client* ws, websocketpp::connection_hdl h, nlohmann::json& duck_msg) 
{
    if (!duck_msg.contains("nd_type")) {
        std::cerr << "NDContext::on_duck_event: no nd_type in " << duck_msg << std::endl;
    }
    const std::string& nd_type(duck_msg["nd_type"]);
    if (nd_type == "ParquetScan") {
        db_status_color = amber;
    }
    else if (nd_type == "Query") {
        db_status_color = amber;
    }
    else if (nd_type == "ParquetScanResult") {
        db_status_color = green;
        action_dispatch(duck_msg["query_id"], nd_type);
    }
    else if (nd_type == "QueryResult") {
        db_status_color = green;
    }
    else if (nd_type == "DuckInstance") {
        // main.ts:on_duck_event invokes check_duck_module
        // we don't need all the check_duck_module JS module stuff,
        // so we can just flip status button color here
        db_status_color = amber;
        nlohmann::json test_query;
        test_query["nd_type"] = "Query";
        test_query["sql"] = "select 1729;";
        test_query["query_id"] = "ramanujan";

        websocketpp::lib::error_code ec;
        ws->send(h, test_query.dump(), websocketpp::frame::opcode::TEXT, ec);
        if (ec) {
            std::cout << "send failed because: " << ec.message() << std::endl;
        }
        // duck_dispatch("Query", "select 1729;", "ramanujan");
    }
    else {
        std::cerr << "NDContext::on_duck_event: unexpected nd_type in " << duck_msg << std::endl;
    }
}

void NDContext::render()
{
    if (pending_pops.size() > 1 || pending_pushes.size() > 1) {
        std::cerr << "render: " << pending_pops.size() << " pending pops, " << pending_pushes.size()
            << " pending pushes" << std::endl;
    }
    // address pending pops first: maintaining ordering by working from front to back
    // as that is the order they would land on the stack if not pushed during rendering
    while (!pending_pops.empty()) {
        pop(pending_pops.front());
        pending_pops.pop_front();
    }
    // drain pending_pushes onto the render stack, maintaining
    // the stack order we would have had if the push had
    // happended intra-render. JOS 2025-01-31
    while (!pending_pushes.empty()) {
        push(pending_pushes.front());
        pending_pushes.pop_front();
    }
    // This loop breaks if we raise a modal as changing stack state while this
    // iter is live segfaults. JS lets us get away with that in main.ts:render
    // Here we push modals into pending_pushes so they can push/pop outside
    // the context of the loop below. JOS 2025-01-31
    for (std::deque<nlohmann::json>::iterator it = stack.begin(); it != stack.end(); ++it) {
        // deref it for clarity and to rename as widget for
        // cross ref with main.ts logic
        nlohmann::json& widget = *it;
        dispatch_render(widget);
    }
}


void NDContext::dispatch_render(nlohmann::json& w)
{
    if (!w.contains("rname")) {
        std::stringstream error_buf;
        error_buf << "dispatch_render: missing rname in " << w << "\n";
        printf(error_buf.str().c_str());
        return;
    }
    auto it = rfmap.find(w["rname"]);
    it->second(w);
}

void NDContext::duck_dispatch(const std::string& nd_type, const std::string& sql, const std::string& qid, ws_client* ws)
{

    std::cout << "cpp: duck_dispatch: nd_type(" << nd_type << "), qid(" << qid << "), sql: " << sql << std::endl;
}

void NDContext::action_dispatch(const std::string& action, const std::string& nd_event)
{
    std::cout << "cpp:action_dispatch: action(" << action << ")" << std::endl;

    if (action.empty()) {
        std::cerr << "cpp:action_dispatch: no action specified!" << std::endl;
        return;
    }
    // Is it a pushable widget? NB this is only for self popping modals like DuckTableSummaryModal.
    // In this case we expect nd_event to be empty as we're not driven directly by the event, but
    // by ui_push and ui_pop action qualifiers associated with the nd_event list. JOS 2025-02-21
    // JOS 2025-02-22
    auto it = pushable.find(action);
    if (it != pushable.end() && nd_event.empty()) {
        std::cout << "cpp:action_dispatch: pushable(" << action << ")" << std::endl;
        stack.push_back(pushable[action]);
    }
    else {
        if (!data.contains("actions")) {
            std::cerr << "cpp:action_dispatch: no actions in data!" << std::endl;
            return;
        }
        // get hold of "actions" in data: do we have one matching action?
        nlohmann::json& actions = data["actions"];
        if (!actions.contains(action)) {
            std::cerr << "cpp:action_dispatch: no actions." << action << " in data!" << std::endl;
            return;
        }
        nlohmann::json& action_defn = actions[action];
        if (!action_defn.contains("nd_events")) {
            std::cerr << "cpp:action_dispatch: no nd_events in actions." << action << " in data!" << std::endl;
            return;
        }
        nlohmann::json nd_events = nlohmann::json::array();
        nd_events = action_defn["nd_events"];
        auto event_iter = nd_events.begin();
        bool event_match = false;
        while (event_iter != nd_events.end()) {
            if (*event_iter++ == nd_event) {
                event_match = true;
                break;
            }
        }
        if (!event_match) {
            std::cerr << "cpp:action_dispatch: no match for nd_event(" << nd_event << ") in defn(" << action_defn << ") in data!" << std::endl;
            return;
        }
        // Now we have a matched action definition in hand we can look
        // for UI push/pop and DB scan/query. If there's both push and pop,
        // pop goes first naturally!
        if (action_defn.contains("ui_pop")) {
            // for pops we supply the rname, not the pushable name so
            // the context can check the widget type on pops
            const std::string& rname(action_defn["ui_pop"]);
            std::cout << "cpp:action_dispatch: ui_pop(" << rname << ")" << std::endl;
            pending_pops.push_back(rname);
        }
        if (action_defn.contains("ui_push")) {
            // for pushes we supply widget_id, not the rname
            const std::string& widget_id(action_defn["ui_push"]);
            // salt'n'pepa in da house!
            auto push_it = pushable.find(widget_id);
            if (push_it != pushable.end()) {
                std::cout << "cpp:action_dispatch: ui_push(" << widget_id << ")" << std::endl;
                // NB action_dispatch is called by eg render_button, which ultimately is called
                // by render(), which iterates over stack. So we cannot change stack here...
                pending_pushes.push_back(push_it->second);
            }
            else {
                std::cerr << "cpp:action_dispatch: ui_push(" << widget_id << ") no such pushable" << std::endl;
            }
        }
        // Finally, do we have a DB op to handle?
        if (action_defn.contains("db")) {
            nlohmann::json& db_op(action_defn["db"]);
            if (!db_op.contains("sql_cname") || !db_op.contains("query_id") || !db_op.contains("action")) {
                std::cerr << "cpp:action_dispatch: db(" << db_op << ") missing sql_cname|query_id|action" << std::endl;
            }
            else {
                const std::string& sql_cache_key(db_op["sql_cname"]);
                if (!data.contains(sql_cache_key)) {
                    std::cerr << "cpp:action_dispatch: db(" << db_op << ") sql_cname(" << sql_cache_key << ") does not resolve" << std::endl;
                }
                else {
                    const std::string& sql(data[sql_cache_key]);
                    // duck_dispatch(db_op["action"], sql, db_op["query_id"]);
                }
            }
        }
    }
}


void NDContext::render_home(nlohmann::json& w)
{
    std::string title = w.value(nlohmann::json::json_pointer("/cspec/title"), "nodom");
    ImGui::Begin(title.c_str());
    nlohmann::json& children = w["children"];
    for (nlohmann::json::iterator it = children.begin(); it != children.end(); ++it) {
        dispatch_render(*it);
    }
    ImGui::End();
}


void NDContext::render_input_int(nlohmann::json& w)
{
    // static storage: imgui wants int (int32), nlohmann::json uses int64_t
    static int input_integer;
    input_integer = 0;
    // params by value
    int step = w.value(nlohmann::json::json_pointer("/cspec/step"), 1);
    int step_fast = w.value(nlohmann::json::json_pointer("/cspec/step_fast"), 1);
    int flags = w.value(nlohmann::json::json_pointer("/cspec/flags"), 0);
    // one param by ref: the int itself
    std::string cname_cache_addr = w.value(nlohmann::json::json_pointer("/cspec/cname"), "render_input_int_bad_cname");
    // label is a layout value
    std::string label = w.value(nlohmann::json::json_pointer("/cspec/label"), "");
    // if no label use cache addr
    if (!label.size()) label = cname_cache_addr;
    // local static copy of cache val
    int old_val = input_integer = data[cname_cache_addr];
    // imgui has ptr to copy of cache val
    ImGui::InputInt(label.c_str(), &input_integer, step, step_fast, flags);
    // copy local copy back into cache
    if (input_integer != old_val) {
        data[cname_cache_addr] = input_integer;
        notify_server_atomic(cname_cache_addr, old_val, input_integer);
    }
}


void NDContext::render_combo(nlohmann::json& w)
{
    // Static storage for the combo list
    // NB single GUI thread!
    // No malloc at runbtime, but we will clear the array with a memset
    // on each visit. JOS 2025-01-26
    static std::vector<std::string> combo_list;
    static const char* cs_combo_list[ND_MAX_COMBO_LIST];
    static int combo_selection;
    memset(cs_combo_list, 0, ND_MAX_COMBO_LIST * sizeof(char*));
    combo_selection = 0;
    combo_list.clear();
    // no value params in layout here; all combo layout is data cache refs
    // /cspec/cname should give us a data cache addr for the combo list
    std::string combo_list_cache_addr = w.value(nlohmann::json::json_pointer("/cspec/cname"), "render_combo_list_bad_cname");
    std::string combo_index_cache_addr = w.value(nlohmann::json::json_pointer("/cspec/index"), "render_combo_list_bad_index");
    std::string label = w.value(nlohmann::json::json_pointer("/cspec/label"), "");
    // if no label use cache addr
    if (!label.size()) label = combo_list_cache_addr;
    int combo_count = 0;
    combo_list = data[combo_list_cache_addr];
    for (auto it = combo_list.begin(); it != combo_list.end(); ++it) {
        cs_combo_list[combo_count++] = it->c_str();
        if (combo_count == ND_MAX_COMBO_LIST) break;
    }
    int old_val = combo_selection = data[combo_index_cache_addr];
    ImGui::Combo(label.c_str(), &combo_selection, cs_combo_list, combo_count, combo_count);
    if (combo_selection != old_val) {
        data[combo_index_cache_addr] = combo_selection;
        notify_server_atomic(combo_index_cache_addr, old_val, combo_selection);
    }
}


void NDContext::render_separator(nlohmann::json& w)
{
    ImGui::Separator();
}


void NDContext::render_footer(nlohmann::json& w)
{
    // TODO: optimise local vars: these cspec are not cache refs so could
    // bound at startup time...
    bool db = w.value(nlohmann::json::json_pointer("/cspec/db"), true);
    bool fps = w.value(nlohmann::json::json_pointer("/cspec/fps"), true);
    bool demo = w.value(nlohmann::json::json_pointer("/cspec/demo"), true);
    bool id_stack = w.value(nlohmann::json::json_pointer("/cspec/id_stack"), true);
    bool memory = w.value(nlohmann::json::json_pointer("/cspec/memory"), true);

    if (db) {
        // Push colour styling for the DB button
        ImGui::PushStyleColor(ImGuiCol_Button, (ImU32)db_status_color);
        if (ImGui::Button("DB")) {
            // TODO: main.ts raises a new brwser tab here...
        }
        ImGui::PopStyleColor(1);
    }
    if (fps) {
        ImGui::SameLine();
        ImGui::Text("Application average %.3f ms/frame (%.1f FPS)", 1000.0f / ImGui::GetIO().Framerate, ImGui::GetIO().Framerate);
    }
    /* TODO
    if (demo) {

    } */
    if (id_stack) {
        ImGui::ShowStackToolWindow();
    }
    /* TODO
    if (memory) {

    } */
}


void NDContext::render_same_line(nlohmann::json& w)
{
    ImGui::SameLine();
}


void NDContext::render_date_picker(nlohmann::json& w)
{
    static int default_table_flags = ImGuiTableFlags_BordersOuter | ImGuiTableFlags_SizingFixedFit |
        ImGuiTableFlags_NoHostExtendX | ImGuiTableFlags_NoHostExtendY;
    static int ymd_i[3] = { 0, 0, 0 };
    static float tsz[2] = { 274.5,301.5 };
    int flags = w.value(nlohmann::json::json_pointer("/cspec/table_flags"), default_table_flags);
    std::string ckey = w.value(nlohmann::json::json_pointer("/cspec/cname"), "render_date_picker_bad_cname");
    nlohmann::json ymd_old_j = nlohmann::json::array();
    ymd_old_j = data[ckey];
    ymd_i[0] = ymd_old_j.at(0);
    ymd_i[1] = ymd_old_j.at(1);
    ymd_i[2] = ymd_old_j.at(2);
    if (ImGui::DatePicker(ckey.c_str(), ymd_i, tsz, false, flags)) {
        nlohmann::json ymd_new_j = nlohmann::json::array();
        ymd_new_j.push_back(ymd_i[0]);
        ymd_new_j.push_back(ymd_i[1]);
        ymd_new_j.push_back(ymd_i[2]);
        data[ckey] = ymd_new_j;
        notify_server_array(ckey, ymd_old_j, ymd_new_j);
    }
}


void NDContext::render_text(nlohmann::json& w)
{
    std::string rtext = w.value(nlohmann::json::json_pointer("/cspec/text"), "");
    ImGui::Text(rtext.c_str());
}


void NDContext::render_button(nlohmann::json& w)
{
    if (!w.contains("cspec")) {
        std::cerr << "render_button: no cspec in w(" << w << ")" << std::endl;
        return;
    }
    nlohmann::json& cspec = w["cspec"];
    if (!cspec.contains("text")) {
        std::cerr << "render_button: no text in cspec(" << cspec << ")" << std::endl;
        return;
    }
    const std::string& button_text = cspec["text"];
    if (ImGui::Button(button_text.c_str())) {
        action_dispatch(button_text, "Button");
    }
}

void NDContext::render_duck_parquet_loading_modal(nlohmann::json& w)
{
    static ImVec2 position = { 0.5, 0.5 };
    std::string cname_cache_addr = w.value(nlohmann::json::json_pointer("/cspec/cname"), "");
    std::string title = w.value(nlohmann::json::json_pointer("/cspec/title"), "");
    ImGui::OpenPopup(title.c_str());

    // Always center this window when appearing
    ImGuiViewport* vp = ImGui::GetMainViewport();
    if (!vp) {
        std::cerr << "render_duck_parquet_loading_modal: cname: " << cname_cache_addr
            << ", title: " << title << ", null viewport ptr!";
    }
    auto center = vp->GetCenter();
    ImGui::SetNextWindowPos(center, ImGuiCond_Appearing, position);

    // Get the parquet url list
    auto pq_urls = data[cname_cache_addr];
    std::cout << "render_duck_parquet_loading_modal: urls: " << pq_urls << std::endl;

    if (ImGui::BeginPopupModal(title.c_str(), nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
        for (int i = 0; i < pq_urls.size(); i++) ImGui::Text(pq_urls[i].get<std::string>().c_str());
        if (!ImGui::Spinner("parquet_loading_spinner", 5, 2, 0)) {
            // TODO: spinner always fails IsClippedEx on first render
            std::cerr << "render_duck_parquet_loading_modal: spinner fail" << std::endl;
        }
        ImGui::EndPopup();
    }
}

void NDContext::render_duck_table_summary_modal(nlohmann::json& w)
{
}


void NDContext::render_table(nlohmann::json& w)
{
    
}

void NDContext::push(nlohmann::json& w)
{
    stack.push_back(w);
}

void NDContext::pop(const std::string& rname)
{
    if (rname.empty()) {
        stack.pop_back();
    }
    else {
        nlohmann::json& w(stack.back());
        if (w["rname"] != rname) {
            std::cerr << "pop mismatch w.rname(" << w["rname"] << ") rname("
                << rname << ")" << std::endl;
        }
    }
}


