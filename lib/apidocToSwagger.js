var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');
const { getDefinition } = require('./generateSchemas');

const extraRefs = [];
const primaryTypes = ['string', 'number', 'boolean'];

var swagger = {
  swagger	: "2.0",
  info	: {},
  paths	: {},
  definitions: {}
};

function toSwagger(apidocJson, projectJson, tsconfigPath) {
  swagger.info = addInfo(projectJson);
  swagger.paths = extractPaths(apidocJson);

  if (tsconfigPath && extraRefs.length) {
    const extraDefinitions = getDefinition(tsconfigPath, extraRefs);
    swagger.definitions = {
      ...swagger.definitions,
      ...extraDefinitions,
    };
  }
  return swagger;
}

// Removes <p> </p> tags from text
var tagsRegex = /(<([^>]+)>)/ig;
function removeTags(text) {
  return text ? text.replace(tagsRegex, "") : text;
}

// Add Project Info
function addInfo(projectJson) {
  var info = {};
  info["title"] = projectJson.title || projectJson.name;
  info["version"] = projectJson.version;
  info["description"] = projectJson.description;
  return info;
}

/**
 * Extracts paths provided in json format
 * post, patch, put request parameters are extracted in body
 * get and delete are extracted to path parameters
 * @param apidocJson
 * @returns {{}}
 */
function extractPaths(apidocJson){
  var apiPaths = groupByUrl(apidocJson);
  var paths = {};
  for (var i = 0; i < apiPaths.length; i++) {
    var verbs = apiPaths[i].verbs;
    var url = verbs[0].url;
    var pattern = pathToRegexp(url, null);
    var matches = pattern.exec(url);

    // Surrounds URL parameters with curly brackets -> :email with {email}
    var pathKeys = []; // 路径参数
    for (var j = 1; j < matches.length; j++) {
      var key = matches[j].substr(1);
      url = url.replace(matches[j], "{"+ key +"}");
      pathKeys.push(key);
    }

    for(var j = 0; j < verbs.length; j++) {
      var verb = verbs[j];
      // 请求方式
      var type = verb.type;

      var obj = paths[url] = paths[url] || {};

      if (type == 'post' || type == 'patch' || type == 'put') {
        _.extend(obj, createPostPushPutOutput(verb, swagger.definitions, pathKeys));
      } else {
        _.extend(obj, createGetDeleteOutput(verb, swagger.definitions));
      }
    }
  }
  return paths;
}

function createPostPushPutOutput(verbs, definitions, pathKeys) {
  var pathItemObject = {};
  var verbDefinitionResult = createVerbDefinitions(verbs,definitions);

  var params = [];
  var pathParams = createPathParameters(verbs, pathKeys);
  pathParams = _.filter(pathParams, function(param) {
    // console.log(pathKeys, param)
    var hasKey = pathKeys.indexOf(param.name) !== -1;
    return !(param.in === "path" && !hasKey)
  });

  params = params.concat(pathParams);
  var required = verbs.parameter && verbs.parameter.fields &&
    verbs.parameter.fields.Parameter && verbs.parameter.fields.Parameter.length > 0;

  if (verbDefinitionResult.topLevelParametersRef) {
    params.push({
      "in": "body",
      "name": "body",
      "description": removeTags(verbs.description),
      "required": required,
      "schema": {
        "$ref": "#/definitions/" + verbDefinitionResult.topLevelParametersRef
      }
    });
  }

  pathItemObject[verbs.type] = {
    tags: [verbs.group],
    summary: removeTags(verbs.title || verbs.name),
    description: removeTags(verbs.description || verbs.title),
    consumes: [
      "application/json"
    ],
    produces: [
      "application/json"
    ],
    parameters: params
  }

  if (verbDefinitionResult.topLevelSuccessRef) {
    pathItemObject[verbs.type].responses = {
      "200": {
        "description": "successful operation",
        "schema": {
          // "items": {
          "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
          // }
        }
      }
    };
  };

  return pathItemObject;
}

function createVerbDefinitions(verb, definitions) {
  var result = {
    topLevelParametersRef : null, // 参数引用
    topLevelSuccessRef : null, // 返回引用
  };
  var defaultObjectName = verb.group + "-" + verb.name; // 默认分组名加接口名为引用名

  // 定义参数引用
  if (verb && verb.parameter && verb.parameter.fields.Body && verb.parameter.fields.Body.length) {
    const topLevelRef = defaultObjectName + '-' + 'Body'
    const defResult = createFieldArrayDefinitions(verb.parameter.fields.Body, definitions, topLevelRef, topLevelRef);
    result.topLevelParametersRef = defResult.topLevelRef;
  };

  // 定义返回引用
  if (verb && verb.success && verb.success.fields && verb.success.fields["Success 200"] && verb.success.fields["Success 200"].length) {
    const topLevelRef = defaultObjectName + '-' + 'Response'
    const defResult = createFieldArrayDefinitions(verb.success.fields["Success 200"], definitions, topLevelRef, topLevelRef);
    result.topLevelSuccessRef = defResult.topLevelRef;
  };

  return result;
}

function createFieldArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName) {
  var result = {
    topLevelRef : topLevelRef,
    topLevelRefType : null
  }

  if (!fieldArray || !fieldArray.length) {
    return result;
  }

  for (var i = 0; i < fieldArray.length; i++) {
    var parameter = fieldArray[i];

    // { propertyName: 'id', objectName: 'data.list' }
    var nestedName = createNestedName(parameter.field);
    // 顶层引用名
    var objectName = nestedName.objectName;
    if (!objectName) {
      objectName = defaultObjectName;
    }
    var type = parameter.type;
    if (i == 0) {
      result.topLevelRefType = type;
      if(parameter.type == "object") {
        objectName = defaultObjectName + '-' + nestedName.propertyName;
        nestedName.propertyName = null;
      } else if (parameter.type == "array") {
        objectName = defaultObjectName + '-' + nestedName.propertyName;
        nestedName.propertyName = null;
        result.topLevelRefType = "array";
      }
      result.topLevelRef = objectName; // undefined
    };

    var defKey = objectName.indexOf(defaultObjectName) === 0 ? objectName : defaultObjectName + '-' + objectName;
    definitions[defKey] = definitions[defKey] || { properties : {}, required : [] };

    if (nestedName.propertyName) {
      // console.log(nestedName.propertyName, parameter.type);

      var prop = { type: (parameter.type || "").toLowerCase(), description: removeTags(parameter.description) };
      // 先判断是否为数组类型
      var typeIndex = type.indexOf("[]");
      if(typeIndex !== -1 && typeIndex === (type.length - 2)) {
        prop.type = "array";
        const itemType = type.slice(0, type.length - 2);
        if (itemType == "object") {
          const innerDefKey = defaultObjectName + '-' + parameter.field;
          prop.items = {
            "$ref": "#/definitions/" + innerDefKey,
          };
          definitions[innerDefKey] = definitions[innerDefKey] || {
            properties : {}, required : [],
            description: removeTags(parameter.description)
          };
        } else if (primaryTypes.includes(itemType)) {
          prop.items = {
            type: itemType,
          };
        } else if (itemType.indexOf('#/definitions') === 0) {
          const ref = itemType.replace('#/definitions/', '');
          extraRefs.push(ref);
          prop.items = {
            "$ref": itemType,
          };
        } else {
          extraRefs.push(itemType);
          prop.items = {
            "$ref": `#/definitions/${itemType}`,
          };
        }
      } else if (parameter.type == "object") {
        prop = {};
        const innerDefKey = defaultObjectName + '-' + parameter.field;
        prop.$ref = "#/definitions/" + innerDefKey;
        definitions[innerDefKey] = definitions[innerDefKey] || {
          properties : {}, required : [],
          description: removeTags(parameter.description)
        };
      } else if (!primaryTypes.includes(parameter.type)) {
        if (parameter.type.indexOf('#/definitions/') === 0) {
          const ref = parameter.type.replace('#/definitions/', '');
          extraRefs.push(ref);
          prop.$ref = parameter.type;
        } else {
          extraRefs.push(parameter.type);
          prop.$ref = "#/definitions/" + parameter.type;
        }
      }

      definitions[defKey]['properties'][nestedName.propertyName] = prop;
      if (!parameter.optional) {
        var arr = definitions[defKey]['required'];
        if(arr.indexOf(nestedName.propertyName) === -1) {
          arr.push(nestedName.propertyName);
        }
      };
    };
  }

  return result;
}

function createNestedName(field) {
  var propertyName = field;
  var objectName;
  var propertyNames = field.split(".");
  if(propertyNames && propertyNames.length > 1) {
    propertyName = propertyNames[propertyNames.length - 1];
    propertyNames.pop();
    objectName = propertyNames.join(".");
  }

  return {
    propertyName: propertyName,
    objectName: objectName
  }
}

/**
 * Generate get, delete method output
 * @param verb
 * @returns {{}}
 */
function createGetDeleteOutput(verb, definitions) {
  var pathItemObject = {};
  verb.type = verb.type === "del" ? "delete" : verb.type;

  var verbDefinitionResult = createVerbDefinitions(verb, definitions);
  pathItemObject[verb.type] = {
    tags: [verb.group],
    summary: removeTags(verb.title || verb.name),
    description: removeTags(verb.description || verb.title),
    consumes: [
      "application/json"
    ],
    produces: [
      "application/json"
    ],
    parameters: createPathParameters(verb),
  }
  if (verbDefinitionResult.topLevelSuccessRef) {
    pathItemObject[verb.type].responses = {
      "200": {
        "description": "接口请求成功",
        "schema": {
          "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
        }
      }
    };
  };
  return pathItemObject;
}

/**
 * Iterate through all method parameters and create array of parameter objects which are stored as path parameters
 * @param verbs
 * @returns {Array}
 */
function createPathParameters(verbs, pathKeys) {
  pathKeys = pathKeys || [];

  var pathItemObject = [];
  if (verbs.header && verbs.header.fields.Header) {
    for (var i = 0; i < verbs.header.fields.Header.length; i++) {
      var param = verbs.header.fields.Header[i];
      var field = param.field;
      var type = param.type;
      pathItemObject.push({
        name: field,
        in: "header",
        required: !param.optional,
        type: param.type.toLowerCase(),
        description: removeTags(param.description)
      });
    }
  }
  if (verbs.parameter && verbs.parameter.fields.Parameter) {
    for (var i = 0; i < verbs.parameter.fields.Parameter.length; i++) {
      var param = verbs.parameter.fields.Parameter[i];
      var field = param.field;
      var type = param.type;
      pathItemObject.push({
        name: field,
        in: type === "file" ? "formData" : "path",
        required: !param.optional,
        type: param.type.toLowerCase(),
        description: removeTags(param.description)
      });
    }
  }
  if (verbs.parameter && verbs.parameter.fields.Query) {
    for (var i = 0; i < verbs.parameter.fields.Query.length; i++) {
      var param = verbs.parameter.fields.Query[i];
      var field = param.field;
      var type = param.type;
      pathItemObject.push({
        name: field,
        in: "query",
        required: !param.optional,
        type: param.type.toLowerCase(),
        description: removeTags(param.description)
      });
    }
  }
  return pathItemObject;
}

function groupByUrl(apidocJson) {
  return _.chain(apidocJson)
    .groupBy("url")
    .toPairs()
    .map(function (element) {
      return _.zipObject(["url", "verbs"], element);
    })
    .value();
}

module.exports = {
  toSwagger: toSwagger
};
