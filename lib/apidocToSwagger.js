var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');

var swagger = {
	swagger	: "2.0",
	info	: {},
	paths	: {},
	definitions: {}
};

function toSwagger(apidocJson, projectJson) {
	swagger.info = addInfo(projectJson);
	swagger.paths = extractPaths(apidocJson);
	return swagger;
}

var tagsRegex = /(<([^>]+)>)/ig;
// Removes <p> </p> tags from text
function removeTags(text) {
	return text ? text.replace(tagsRegex, "") : text;
}

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
		var pathKeys = [];
		for (var j = 1; j < matches.length; j++) {
			var key = matches[j].substr(1);
			url = url.replace(matches[j], "{"+ key +"}");
			pathKeys.push(key);
		}

		for(var j = 0; j < verbs.length; j++) {
			var verb = verbs[j];
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
              // "type": verbDefinitionResult.topLevelSuccessRefType,
              // "items": {
                "$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
              // }
            }
          }
				};
	};

	return pathItemObject;
}

function createVerbDefinitions(verbs, definitions) {
	// console.log('verbs', verbs)
	// console.log('definitions', definitions)
	var result = {
		topLevelParametersRef : null,
		topLevelSuccessRef : null,
		topLevelSuccessRefType : null
	};
	var defaultObjectName = verbs.group + "-" + verbs.name; // 默认接口名为引用名

	var fieldArrayResult = {};
	if (verbs && verbs.parameter && verbs.parameter.fields.Body && verbs.parameter.fields.Body.length) {
		const topLevelRef = defaultObjectName + '-' + 'Body'
		fieldArrayResult = createFieldArrayDefinitions(verbs.parameter.fields.Body, definitions, topLevelRef, topLevelRef);
		result.topLevelParametersRef = fieldArrayResult.topLevelRef;
	};

	if (verbs && verbs.success && verbs.success.fields && verbs.success.fields["Success 200"] && verbs.success.fields["Success 200"].length) {
		const topLevelRef = defaultObjectName + '-' + 'Response'
		fieldArrayResult = createFieldArrayDefinitions(verbs.success.fields["Success 200"], definitions, topLevelRef, topLevelRef);
		result.topLevelSuccessRef = fieldArrayResult.topLevelRef;
		result.topLevelSuccessRefType = fieldArrayResult.topLevelRefType;
	};

	return result;
}

function createFieldArrayDefinitions(fieldArray, definitions, topLevelRef, defaultObjectName) {
	// console.log('fieldArray', fieldArray);
	// console.log('definitions', definitions);
	// console.log('topLevelRef', topLevelRef);
	// console.log('defaultObjectName', defaultObjectName);
	var result = {
		topLevelRef : topLevelRef,
		topLevelRefType : null
	}

	if (!fieldArray || !fieldArray.length) {
		return result;
	}

	// console.log(defaultObjectName, topLevelRef)
	for (var i = 0; i < fieldArray.length; i++) {
		var parameter = fieldArray[i];

		var nestedName = createNestedName(parameter.field);
		var objectName = nestedName.objectName;
		if (!objectName) {
			objectName = defaultObjectName;
		}
		var type = parameter.type;
		// console.log(type, objectName, nestedName)
		// object createBimFile { propertyName: 'bim', objectName: undefined }
		if (i == 0) {
			result.topLevelRefType = type;
			// console.log(type, nestedName)
			if(parameter.type == "object") {
				objectName = defaultObjectName + '-' + nestedName.propertyName; // bim
				nestedName.propertyName = null;
			} else if (parameter.type == "array") {
				objectName = defaultObjectName + '-' + nestedName.propertyName; // bim
				nestedName.propertyName = null;
				result.topLevelRefType = "array";
			}
			result.topLevelRef = objectName; // undefined
			// console.log(objectName)
		};

		var defKey = objectName.indexOf(defaultObjectName) === 0 ? objectName : defaultObjectName + '-' + objectName;
		definitions[defKey] = definitions[defKey] || { properties : {}, required : [] };

		if (nestedName.propertyName) {
			var prop = { type: (parameter.type || "").toLowerCase(), description: removeTags(parameter.description) };
			if(parameter.type == "object") {
				prop = {}
				const innerDefKey = defaultObjectName + '-' + parameter.field;
				prop.$ref = "#/definitions/" + innerDefKey;
				definitions[innerDefKey] = definitions[innerDefKey] || {
					properties : {}, required : [],
					description: removeTags(parameter.description)
				};
			}

			var typeIndex = type.indexOf("[]");
			if(typeIndex !== -1 && typeIndex === (type.length - 2)) {
				prop.type = "array";
				const itemType = type.slice(0, type.length-2)
				if (itemType == "object") {
					const innerDefKey = defaultObjectName + '-' + parameter.field;
					prop.items = {
						"$ref": "#/definitions/" + innerDefKey,
					};
					definitions[innerDefKey] = definitions[innerDefKey] || {
						properties : {}, required : [],
						description: removeTags(parameter.description)
					};
				} else {
					prop.items = {
						type: type.slice(0, type.length-2)
					};
				}
			}

			// objectName 为 bim 或 接口名
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
		propertyName = propertyNames[propertyNames.length-1];
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
 * @param verbs
 * @returns {{}}
 */
function createGetDeleteOutput(verbs,definitions) {
	var pathItemObject = {};
	verbs.type = verbs.type === "del" ? "delete" : verbs.type;

	var verbDefinitionResult = createVerbDefinitions(verbs,definitions);
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
		parameters: createPathParameters(verbs),
	}
	if (verbDefinitionResult.topLevelSuccessRef) {
		pathItemObject[verbs.type].responses = {
          "200": {
            "description": "successful operation",
            "schema": {
              // "type": verbDefinitionResult.topLevelSuccessRefType,
							"$ref": "#/definitions/" + verbDefinitionResult.topLevelSuccessRef
              // "items": {
              // }
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
