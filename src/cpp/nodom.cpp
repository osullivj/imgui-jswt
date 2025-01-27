#include "imgui.h"
#include "imgui_impl_glfw.h"
#include "imgui_impl_opengl3.h"
#include <stdio.h>
// STL
#include <string>
#include <list>
#include <fstream>
#include <iostream>
#include <sstream>
#include <functional>
#include <vector>
// nlohmann/json/single_include/nlohmann/json.hpp
// pybind11
#include <pybind11/embed.h>

#include "nodom.hpp"

// Python consts
static std::string    on_client_data_changes_s("on_client_data_changes");
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


NDServer::NDServer(const char* root_dir, const char* test)
    :root_path(root_dir), test_name(test)
{
    if (!init_python()) exit(1);

    load_json();
}

NDServer::~NDServer() {
    fini_python();
}

bool NDServer::init_python()
{
    try {
        pybind11::initialize_interpreter();
        // PYTHONHOME and PYTHONPATH env vars should be set
        // for this to work. See ide.cmd for examples.
        auto sys_module = pybind11::module_::import(sys_cs);
        auto path_p = sys_module.attr(path_cs);
        pybind11::print("sys.path=", path_p);
        auto test_module = pybind11::module_::import(test_name.c_str());
        pybind11::dict __nodom__ = test_module.attr(pybind11::str(__nodom__cs));
        on_client_data_changes_f = __nodom__[pybind11::str(on_client_data_changes_s)];
    }
    catch (pybind11::error_already_set& ex) {
        std::cerr << ex.what() << std::endl;
        return false;
    }
    return true;
}


bool NDServer::fini_python()
{
    pybind11::finalize_interpreter();
    return true;
}

bool NDServer::load_json()
{
    // bool rv = true;
    std::list<std::string> json_files = { "layout", "data" };
    for (auto jf : json_files) {
        std::stringstream file_name_buffer;
        file_name_buffer << root_path << "\\dat\\test\\" << test_name << "\\" << jf << ".json";
        std::string json_path = file_name_buffer.str();
        std::cout << "load_json: " << json_path << std::endl;
        std::stringstream json_buffer;
        std::ifstream in_file_stream(json_path);
        json_buffer << in_file_stream.rdbuf();
        json_map[jf] = json_buffer.str();
    }
    return true;
}

nlohmann::json NDServer::notify_server_atomic(const std::string& caddr, int old_val, int new_val)
{
    // the client has set data[caddr]=new_val, so let the server side python know so
    // it can react with its own changes
    pybind11::dict nd_message;
    // NDAPIApp.on_ws_message() invokes on_data_change() to apply the changes to the
    // server side cache, and changes nd_type from DataChange to DataChangeConfigmed
    // before replaying to client side. New server side changes will be appended...
    nd_message[nd_type_cs] = data_change_confirmed_cs;
    nd_message[cache_key_cs] = caddr;
    nd_message[new_value_cs] = new_val;
    nd_message[old_value_cs] = old_val;
    // on_client_data_changes expects a list of nd_messages: size to one
    pybind11::list client_changes(1);
    client_changes.append(nd_message);
    pybind11::list server_changes_p = on_client_data_changes_f(client_changes);
    nlohmann::json server_changes_j = nlohmann::json::array();
    for (int i = 0; i < server_changes_p.size(); i++) {
        pybind11::dict change_p = server_changes_p[i];
        if (change_p[nd_type_cs] == pybind11::str(data_change_cs)) {
            nlohmann::json change_j;
            change_j[nd_type_cs] = data_change_s;
            change_j[new_value_cs] = pybind11::cast<int>(change_p[new_value_cs]);
            change_j[old_value_cs] = pybind11::cast<int>(change_p[old_value_cs]);
            server_changes_j.push_back(change_j);
        }
    }
    return server_changes_j;
}

NDContext::NDContext(NDServer& s)
    :server(s)
{
    // emulate the main.ts NDContext fetch from server side
    std::string layout_s = server.fetch("layout");
    layout = nlohmann::json::parse(layout_s);
    data = nlohmann::json::parse(server.fetch("data"));

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
    for (nlohmann::json::iterator it = server_changes.begin(); it != server_changes.end(); ++it) {
        nlohmann::json change(*it);
        std::string cache_key = change[cache_key_cs];
        // polymorphic as types are hidden inside change
        data[cache_key] = change[new_value_cs];
    }
}


void NDContext::render()
{
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
        nlohmann::json server_changes_j = server.notify_server_atomic(cname_cache_addr, old_val, input_integer);
        apply_server_changes(server_changes_j);
    }
}


void NDContext::render_combo(nlohmann::json& w)
{
    // Static storage for the combo list
    // NB single GUI thread!
    // No malloc at runbtime, but we will clear the array with a memset
    // on each visit. JOS 2025-01-26
    static std::vector<std::string> combo_list;
    static char* cs_combo_list[ND_MAX_COMBO_LIST];
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
        cs_combo_list[combo_count++] = (char*)it->c_str();
        if (combo_count == ND_MAX_COMBO_LIST) break;
    }
    int old_val = combo_selection = data[combo_index_cache_addr];
    ImGui::Combo(label.c_str(), &combo_selection, cs_combo_list, combo_count);
    if (combo_selection != old_val) {
        data[combo_index_cache_addr] = combo_selection;
        nlohmann::json server_changes_j = server.notify_server_atomic(combo_index_cache_addr, old_val, combo_selection);
        apply_server_changes(server_changes_j);
    }
}


void NDContext::render_separator(nlohmann::json& w)
{
    ImGui::Separator();
}


void NDContext::render_footer(nlohmann::json& w)
{
}


void NDContext::render_same_line(nlohmann::json& w)
{
    ImGui::SameLine();
}


void NDContext::render_date_picker(nlohmann::json& w)
{
}


void NDContext::render_text(nlohmann::json& w)
{
}


void NDContext::render_button(nlohmann::json& w)
{
    std::string button_text = w.value(nlohmann::json::json_pointer("/cspec/text"), "render_button_bad_text");
    if (ImGui::Button(button_text.c_str())) {
        // TODO dispatch click
    }
}


void NDContext::render_duck_table_summary_modal(nlohmann::json& w)
{
}


void NDContext::render_duck_parquet_loading_modal(nlohmann::json& w)
{
}


void NDContext::render_table(nlohmann::json& w)
{
}



