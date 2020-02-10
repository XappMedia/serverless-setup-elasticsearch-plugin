# serverless-setup-elasticsearch-plugin
This is a plugin that can help automate setup for elasticsearch via a Serverless deploy.

# Install

```
npm install --save-dev @xapp/serverless-setup-elasticsearch-plugin
```

# Usage

## Setting up index

To set up the mappings for an index, first create a JSON or Javascript file with the provided mappings. Save this file in your project folder.

<projectRoot>/elasticsearch/setup/exampleIndex.json
```
{
    "mappings": {
        "key1": {
            "type": "keyword"
        }
    }
}
```

In the serverless.yml file, place an `elasticsearch` parameter in the `custom` section which contains the elasticsearch domain and indices you want to set up.

serverless.yml
```
provider:
 ...

custom:
  elasticsearch:
     endpoint: https://<urlToElasticsearch>
     indices:
       - name: testIndex
         file: ./elasticsearch/setup/exampleIndex.json
```

The file `url` can be either an absolute path location or relative.  The relative path location will be relative to the shell location that is running the script (generally the root of the project).

Indices can not be created again once they already exist. This plugin will completely ignore a `resource already created` error if it receives one.  In order to change the index, you must first delete the previous index then create a new. If you need to keep the data, then you must first create a second index, fill the data to the new index, then delete the old index.  The use of Index Aliases makes this less of a pain. It allows you to swap indices without updating code by simply moving the alias from the previous index to the new index.

Elasticsearch index mappings docs:
https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html

Elasticsearch index alias docs:
https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-aliases.html

## Setting up a template

Setting up a template is very similar to setting up an index. First, you must create a JSON file that contains the body to send to elasticsearch.

<projectRoot>/elasticsearch/setup/exampleTemplate.json
```
  {
      "index_patterns": ["testIndex*],
      "mappings": {
          "_doc": {
              "properties": {
                  "key": {
                      "type": "keyword"
                  }
              }
          }
      }
  }
```

In the serverless.yml file, place an `elasticsearch` parameter in the `custom` section which contains the elasticsearch domain and templates you want to set up.

serverless.yml
```
provider:
 ...

custom:
  elasticsearch:
     endpoint: https://<urlToElasticsearch>
     templates:
       - name: testTemplate
         file: ./elasticsearch/setup/exampleTemplate.json
```

The file `url` can be either an absolute path location or relative.  The relative path location will be relative to the shell location that is running the script (generally the root of the project).

Elasticsearch index templates docs:
https://www.elastic.co/guide/en/elasticsearch/reference/current/indices-templates.html

## Domain Retrieval

If the domain of the Elasticsearch service is not known at time of writing the file, then it can be retrieved through other means:

### CloudFormation

Output the Elasticsearch domain to Cloudformation. The output can be set and the domain will be retrieved after.

serverless.yml
```
custom:
   elasticsearch:
     cf-domain: elasticsearch-domainEndpoint
     indices:
       - name: testIndex
         file: ./location/of/the/file.json

resources:
  Resources:

    elasticSearch:
      Type: AWS::Elasticsearch::Domain
      Properties:
        ... ES Setup ...

  Outputs:

     elasticSearchDomain:
       Value:
         Fn::GetAtt:
           - elasticSearch
           - DomainEndpoint
      Export:
        Name: elasticsearch-domainEndpoint
```

The plugin will use the set AWS credentials to pull the elasticsearch domain from Cloudformation. It will also retrieve the `region` and `profile` from the serverless.yml `provider` section.