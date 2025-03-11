/***************************************************************************
* Copyright (c) 2019, Martin Renou                                         *
*                                                                          *
* Distributed under the terms of the BSD 3-Clause License.                 *
*                                                                          *
* The full license is in the file LICENSE, distributed with this software. *
****************************************************************************/

#ifndef PYBIND11_JSON_HPP
#define PYBIND11_JSON_HPP

#include <set>
#include <string>
#include <vector>

#include "json.hpp"

#include "pybind11/pybind11.h"

#include "arrow/python/pyarrow.h"

namespace py = pybind11;
namespace nl = nlohmann;

namespace pyjson
{
    inline py::object from_json(const nl::json& j)
    {
        if (j.is_null())
        {
            return py::none();
        }
        else if (j.is_boolean())
        {
            return py::bool_(j.get<bool>());
        }
        else if (j.is_number_unsigned())
        {
            return py::int_(j.get<nl::json::number_unsigned_t>());
        }
        else if (j.is_number_integer())
        {
            return py::int_(j.get<nl::json::number_integer_t>());
        }
        else if (j.is_number_float())
        {
            return py::float_(j.get<double>());
        }
        else if (j.is_string())
        {
            return py::str(j.get<std::string>());
        }
        else if (j.is_array())
        {
            py::list obj(j.size());
            for (std::size_t i = 0; i < j.size(); i++)
            {
                obj[i] = from_json(j[i]);
            }
            return obj;
        }
        else // Object
        {
            py::dict obj;
            for (nl::json::const_iterator it = j.cbegin(); it != j.cend(); ++it)
            {
                obj[py::str(it.key())] = from_json(it.value());
            }
            return obj;
        }
    }

    inline nl::json to_json(const py::handle& obj, std::set<const PyObject*>& refs)
    {
        if (obj.ptr() == nullptr || obj.is_none())
        {
            return nullptr;
        }
        if (py::isinstance<py::bool_>(obj))
        {
            return obj.cast<bool>();
        }
        if (py::isinstance<py::int_>(obj))
        {
            try
            {
                nl::json::number_integer_t s = obj.cast<nl::json::number_integer_t>();
                if (py::int_(s).equal(obj))
                {
                    return s;
                }
            }
            catch (...)
            {
            }
            try
            {
                nl::json::number_unsigned_t u = obj.cast<nl::json::number_unsigned_t>();
                if (py::int_(u).equal(obj))
                {
                    return u;
                }
            }
            catch (...)
            {
            }
            throw std::runtime_error("to_json received an integer out of range for both nl::json::number_integer_t and nl::json::number_unsigned_t type: " + py::repr(obj).cast<std::string>());
        }
        if (py::isinstance<py::float_>(obj))
        {
            return obj.cast<double>();
        }
        if (py::isinstance<py::bytes>(obj))
        {
            py::module base64 = py::module::import("base64");
            return base64.attr("b64encode")(obj).attr("decode")("utf-8").cast<std::string>();
        }
        if (py::isinstance<py::str>(obj))
        {
            return obj.cast<std::string>();
        }
        if (py::isinstance<py::tuple>(obj) || py::isinstance<py::list>(obj))
        {
            auto insert_ret = refs.insert(obj.ptr());
            if (!insert_ret.second) {
                throw std::runtime_error("Circular reference detected");
            }

            auto out = nl::json::array();
            for (const py::handle value : obj)
            {
                out.push_back(to_json(value, refs));
            }

            refs.erase(insert_ret.first);

            return out;
        }
        if (py::isinstance<py::dict>(obj))
        {
            auto insert_ret = refs.insert(obj.ptr());
            if (!insert_ret.second) {
                throw std::runtime_error("Circular reference detected");
            }

            auto out = nl::json::object();
            for (const py::handle key : obj)
            {
                out[py::str(key).cast<std::string>()] = to_json(obj[key], refs);
            }

            refs.erase(insert_ret.first);

            return out;
        }
        if (pybind11::hasattr(obj, "__arrow_c_stream__")) {
            // pyarrow.lib.Table: the DuckDB result set type for Python and JS APIs
            // https://arrow.apache.org/docs/format/CDataInterface/PyCapsuleInterface.html
            // obj is a pybind11::handle instance; invoking .ptr() gives us a PyObject*
            if (arrow::py::is_table(obj.ptr())) {
                auto result = arrow::py::unwrap_table(obj.ptr());
                if (result.ok()) {
                    // get hold of the underlying raw ptr and stuff it into a uint
                    std::shared_ptr<arrow::Table> arrow_table(result.ValueOrDie());
                    nl::json::number_unsigned_t u(reinterpret_cast<std::uint64_t>(arrow_table.get()));
                    return u;
                }
                else {
                    throw std::runtime_error("arrow::Table unwrap failed");
                }
            }
        }
        throw std::runtime_error("to_json not implemented for this type of object: " + py::repr(obj).cast<std::string>());
    }

    inline nl::json to_json(const py::handle& obj)
    {
        std::set<const PyObject*> refs;
        return to_json(obj, refs);
    }

}

// nlohmann_json serializers
namespace nlohmann
{
    #define MAKE_NLJSON_SERIALIZER_DESERIALIZER(T)         \
    template <>                                            \
    struct adl_serializer<T>                               \
    {                                                      \
        inline static void to_json(json& j, const T& obj)  \
        {                                                  \
            j = pyjson::to_json(obj);                      \
        }                                                  \
                                                           \
        inline static T from_json(const json& j)           \
        {                                                  \
            return pyjson::from_json(j);                   \
        }                                                  \
    }

    #define MAKE_NLJSON_SERIALIZER_ONLY(T)                 \
    template <>                                            \
    struct adl_serializer<T>                               \
    {                                                      \
        inline static void to_json(json& j, const T& obj)  \
        {                                                  \
            j = pyjson::to_json(obj);                      \
        }                                                  \
    }

    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::object);

    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::bool_);
    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::int_);
    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::float_);
    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::str);

    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::list);
    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::tuple);
    MAKE_NLJSON_SERIALIZER_DESERIALIZER(py::dict);

    MAKE_NLJSON_SERIALIZER_ONLY(py::handle);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::item_accessor);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::list_accessor);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::tuple_accessor);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::sequence_accessor);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::str_attr_accessor);
    MAKE_NLJSON_SERIALIZER_ONLY(py::detail::obj_attr_accessor);

    #undef MAKE_NLJSON_SERIALIZER
    #undef MAKE_NLJSON_SERIALIZER_ONLY
}

// pybind11 caster
namespace pybind11
{
    namespace detail
    {
        template <> struct type_caster<nl::json>
        {
        public:
            PYBIND11_TYPE_CASTER(nl::json, _("json"));

            bool load(handle src, bool)
            {
                try
                {
                    value = pyjson::to_json(src);
                    return true;
                }
                catch (...)
                {
                    return false;
                }
            }

            static handle cast(nl::json src, return_value_policy /* policy */, handle /* parent */)
            {
                object obj = pyjson::from_json(src);
                return obj.release();
            }
        };

        template <typename TableType>
        struct gen_type_caster
        {
        public:
            PYBIND11_TYPE_CASTER(std::shared_ptr<TableType>, _("pyarrow::Table"));
            // Python -> C++
            bool load(handle src, bool)
            {
                PyObject* source = src.ptr();
                if (!arrow::py::is_table(source))
                    return false;
                arrow::Result<std::shared_ptr<arrow::Table>> result = arrow::py::unwrap_table(source);
                if (!result.ok())
                    return false;
                value = std::static_pointer_cast<TableType>(result.ValueOrDie());
                return true;
            }
            // C++ -> Python
            static handle cast(std::shared_ptr<TableType> src, return_value_policy /* policy */, handle /* parent */)
            {
                return arrow::py::wrap_table(src);
            }
        };
        template <>
        struct type_caster<std::shared_ptr<arrow::Table>> : public gen_type_caster<arrow::Table>
        {
        };
    }
}

#endif
