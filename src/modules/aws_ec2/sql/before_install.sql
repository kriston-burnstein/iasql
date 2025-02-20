 -- Create target group instance constraint
CREATE
OR REPLACE FUNCTION check_target_group_instance (_target_group_id INTEGER) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  _target_group_type target_group_target_type_enum;
begin
  select target_type into _target_group_type
  from target_group
  where id = _target_group_id;
  return _target_group_type = 'instance';
end;
$$;

-- Create role ec2 instance profile constraint
-- CREATE INDEX
--   role_policy_document_gin_idx ON iam_role USING gin ((assume_role_policy_document -> 'Statement') jsonb_path_ops);
CREATE
OR REPLACE FUNCTION check_role_ec2 (_role_name TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  _number_of_records integer;
begin
  select count(*) into _number_of_records
  from iam_role
  where role_name = _role_name AND assume_role_policy_document -> 'Statement' @> '[{"Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }}]';
  return _number_of_records > 0;
end;
$$;

-- Create EC2 instance and EBS volume must be in the same availability zone
CREATE
OR REPLACE FUNCTION check_instance_ebs_availability_zone (_instance_id INTEGER, _ebs_availability_zone CHARACTER VARYING) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  _instance_availability_zone character varying;
begin
  select subnet.availability_zone into _instance_availability_zone
  from instance
  inner join subnet on subnet.id = instance.subnet_id
  where instance.id = _instance_id;
  return _instance_availability_zone::text = _ebs_availability_zone::text;
end;
$$;
