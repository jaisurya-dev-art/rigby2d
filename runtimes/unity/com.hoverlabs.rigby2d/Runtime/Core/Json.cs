// SPDX-License-Identifier: MIT OR Apache-2.0
// A small JSON value type and parser. Objects keep their key order, which the skeleton format relies
// on (animations, skins and timelines are listed in file order). No dependencies, so the core runs
// in any .NET runtime, Unity included. A port of runtimes/rust/rigby-runtime/src/json.rs.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Rigby2D
{
    public enum JsonType : byte { Null, Bool, Num, Str, Arr, Obj }

    public sealed class Json
    {
        public static readonly Json Null = new Json(JsonType.Null);
        static readonly Json True = new Json(JsonType.Bool) { bval = true };
        static readonly Json False = new Json(JsonType.Bool) { bval = false };
        static readonly List<Json> NoItems = new List<Json>(0);
        static readonly List<KeyValuePair<string, Json>> NoEntries = new List<KeyValuePair<string, Json>>(0);

        public readonly JsonType Type;
        bool bval;
        double nval;
        string sval;
        List<Json> items;
        List<KeyValuePair<string, Json>> entries;
        Dictionary<string, int> index;

        Json(JsonType type) => Type = type;

        public static Json Bool(bool b) => b ? True : False;
        public static Json Num(double n) => new Json(JsonType.Num) { nval = n };
        public static Json Str(string s) => new Json(JsonType.Str) { sval = s };
        public static Json Arr(List<Json> list) => new Json(JsonType.Arr) { items = list };
        public static Json Obj() => new Json(JsonType.Obj) { entries = new List<KeyValuePair<string, Json>>() };

        public bool IsNull => Type == JsonType.Null;
        public bool IsArray => Type == JsonType.Arr;
        public bool IsObject => Type == JsonType.Obj;

        /// <summary>The value of key in an object (Null when missing or not an object).</summary>
        public Json this[string key]
        {
            get
            {
                if (Type != JsonType.Obj) return Null;
                if (index != null) return index.TryGetValue(key, out int i) ? entries[i].Value : Null;
                for (int i = 0; i < entries.Count; i++)
                    if (entries[i].Key == key) return entries[i].Value;
                return Null;
            }
        }

        public Json Get(string key) => this[key];
        public bool Has(string key) => !this[key].IsNull;

        public double? AsNumber => Type == JsonType.Num ? nval : (double?)null;
        public string AsString => Type == JsonType.Str ? sval : null;
        public bool? AsBool => Type == JsonType.Bool ? bval : (bool?)null;
        public List<Json> AsArray => Type == JsonType.Arr ? items : NoItems;

        /// <summary>Object entries in file order (empty for anything else).</summary>
        public List<KeyValuePair<string, Json>> Entries => Type == JsonType.Obj ? entries : NoEntries;

        /// <summary>Number at key, or def.</summary>
        public double Num(string key, double def) => this[key].AsNumber ?? def;

        /// <summary>JavaScript-style truthiness of key (!!value).</summary>
        public bool Truthy(string key)
        {
            var v = this[key];
            switch (v.Type)
            {
                case JsonType.Null: return false;
                case JsonType.Bool: return v.bval;
                case JsonType.Num: return v.nval != 0.0 && !double.IsNaN(v.nval);
                case JsonType.Str: return v.sval.Length > 0;
                default: return true;
            }
        }

        /// <summary>Boolean at key, or def when missing (value ?? def).</summary>
        public bool Flag(string key, bool def) => this[key].IsNull ? def : Truthy(key);

        public string StrOr(string key, string def) => this[key].AsString ?? def;

        /// <summary>Sets key in an object (keeping its position when it exists); no effect otherwise.</summary>
        public void Set(string key, Json value)
        {
            if (Type != JsonType.Obj) return;
            for (int i = 0; i < entries.Count; i++)
            {
                if (entries[i].Key != key) continue;
                entries[i] = new KeyValuePair<string, Json>(key, value);
                return;
            }
            entries.Add(new KeyValuePair<string, Json>(key, value));
            index?.Add(key, entries.Count - 1);
        }

        public Json Remove(string key)
        {
            if (Type != JsonType.Obj) return null;
            for (int i = 0; i < entries.Count; i++)
            {
                if (entries[i].Key != key) continue;
                var v = entries[i].Value;
                entries.RemoveAt(i);
                index = null;
                return v;
            }
            return null;
        }

        /// <summary>Parses JSON text.</summary>
        public static Json Parse(string text)
        {
            var p = new Parser(text);
            if (text.Length > 0 && text[0] == '﻿') p.I = 1;
            p.Ws();
            var v = p.Value(0);
            p.Ws();
            if (p.I != text.Length) throw p.Err("unexpected data after the JSON value");
            return v;
        }

        /// <summary>Parses UTF-8 JSON bytes.</summary>
        public static Json Parse(byte[] utf8) => Parse(new UTF8Encoding(false, true).GetString(utf8));

        sealed class Parser
        {
            const int MaxDepth = 512;
            readonly string s;
            public int I;
            readonly StringBuilder sb = new StringBuilder();

            public Parser(string text) => s = text;

            public JsonParseException Err(string message) => new JsonParseException(message, I);

            public void Ws()
            {
                while (I < s.Length)
                {
                    char c = s[I];
                    if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
                    I++;
                }
            }

            int Peek() => I < s.Length ? s[I] : -1;

            void Expect(string lit)
            {
                if (string.CompareOrdinal(s, I, lit, 0, lit.Length) != 0) throw Err("invalid literal");
                I += lit.Length;
            }

            public Json Value(int depth)
            {
                if (depth > MaxDepth) throw Err("JSON nested too deeply");
                int c = Peek();
                switch (c)
                {
                    case -1:
                        throw Err("unexpected end of JSON");
                    case '{':
                    {
                        I++;
                        var obj = Obj();
                        Ws();
                        if (Peek() == '}')
                        {
                            I++;
                            return obj;
                        }
                        Dictionary<string, int> seen = null;
                        while (true)
                        {
                            Ws();
                            if (Peek() != '"') throw Err("expected a string key");
                            string k = String();
                            Ws();
                            if (Peek() != ':') throw Err("expected ':'");
                            I++;
                            Ws();
                            var v = Value(depth + 1);
                            // Like JSON.parse: a repeated key keeps the last value, in the first position.
                            if (seen == null && obj.entries.Count >= 8)
                            {
                                seen = new Dictionary<string, int>(obj.entries.Count * 2, StringComparer.Ordinal);
                                for (int i = 0; i < obj.entries.Count; i++) seen[obj.entries[i].Key] = i;
                            }
                            int at = -1;
                            if (seen != null)
                            {
                                if (!seen.TryGetValue(k, out at)) at = -1;
                            }
                            else
                            {
                                for (int i = 0; i < obj.entries.Count; i++)
                                    if (obj.entries[i].Key == k)
                                    {
                                        at = i;
                                        break;
                                    }
                            }
                            if (at >= 0) obj.entries[at] = new KeyValuePair<string, Json>(k, v);
                            else
                            {
                                obj.entries.Add(new KeyValuePair<string, Json>(k, v));
                                seen?.Add(k, obj.entries.Count - 1);
                            }
                            Ws();
                            int n = Peek();
                            if (n == ',') I++;
                            else if (n == '}')
                            {
                                I++;
                                obj.index = seen;
                                return obj;
                            }
                            else throw Err("expected ',' or '}'");
                        }
                    }
                    case '[':
                    {
                        I++;
                        var list = new List<Json>();
                        Ws();
                        if (Peek() == ']')
                        {
                            I++;
                            return Arr(list);
                        }
                        while (true)
                        {
                            Ws();
                            list.Add(Value(depth + 1));
                            Ws();
                            int n = Peek();
                            if (n == ',') I++;
                            else if (n == ']')
                            {
                                I++;
                                return Arr(list);
                            }
                            else throw Err("expected ',' or ']'");
                        }
                    }
                    case '"':
                        return Str(String());
                    case 't':
                        Expect("true");
                        return True;
                    case 'f':
                        Expect("false");
                        return False;
                    case 'n':
                        Expect("null");
                        return Null;
                    default:
                        return Number();
                }
            }

            Json Number()
            {
                int start = I;
                while (I < s.Length)
                {
                    char c = s[I];
                    if (!(c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' || (c >= '0' && c <= '9'))) break;
                    I++;
                }
                string text = s.Substring(start, I - start);
                if (text.Length == 0 || !double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double v))
                    throw new JsonParseException($"invalid number '{text}'", start);
                return Num(v);
            }

            int Hex4()
            {
                if (I + 4 > s.Length) throw Err("invalid \\u escape");
                if (!int.TryParse(s.Substring(I, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out int v))
                    throw Err("invalid \\u escape");
                I += 4;
                return v;
            }

            string String()
            {
                I++; // opening quote
                // Fast path: no escapes.
                int start = I;
                while (I < s.Length)
                {
                    char c = s[I];
                    if (c == '"')
                    {
                        I++;
                        return s.Substring(start, I - 1 - start);
                    }
                    if (c == '\\') break;
                    I++;
                }
                sb.Clear();
                sb.Append(s, start, I - start);
                while (true)
                {
                    if (I >= s.Length) throw Err("unterminated string");
                    char c = s[I++];
                    if (c == '"') break;
                    if (c != '\\')
                    {
                        sb.Append(c);
                        continue;
                    }
                    if (I >= s.Length) throw Err("unterminated string");
                    char e = s[I++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                        {
                            int cp = Hex4();
                            if (cp >= 0xd800 && cp < 0xdc00 && I + 1 < s.Length && s[I] == '\\' && s[I + 1] == 'u')
                            {
                                int save = I;
                                I += 2;
                                int lo = Hex4();
                                if (lo >= 0xdc00 && lo < 0xe000) cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                                else I = save;
                            }
                            if (cp >= 0xd800 && cp < 0xe000) sb.Append('�');
                            else sb.Append(char.ConvertFromUtf32(cp));
                            break;
                        }
                        default:
                            throw Err("invalid escape");
                    }
                }
                return sb.ToString();
            }
        }
    }

    public sealed class JsonParseException : Exception
    {
        public readonly int Offset;

        public JsonParseException(string message, int offset) : base($"{message} at character {offset}") => Offset = offset;
    }
}
